//! The scraper Lambda: lists the audio and video files a web page links to.
//!
//! It answers `POST /scrape/media` with a JSON body `{"url": "..."}`, sent by
//! the Cloudflare Worker in `web/worker/`. It fetches the page, streams it
//! through an HTML tokenizer without building a DOM, and answers
//! `{"url": <final URL>, "links": [<absolute URLs>]}`. Failures answer
//! `{"error": <code>}`; `web/src/api/wire.ts` holds the browser's copy of
//! these shapes.

use std::collections::HashSet;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use encoding_rs::Encoding;
use lambda_http::http::{HeaderMap, HeaderValue, Method, StatusCode, header};
use lambda_http::{Body, Error, Request, Response, run, service_fn};
use lol_html::errors::RewritingError;
use lol_html::send::{Element, HtmlRewriter, Settings};
use lol_html::{AsciiCompatibleEncoding, element};
use serde::{Deserialize, Serialize};
use url::Url;

/// Header the Cloudflare Worker adds to every request it forwards. The function
/// URL is public, so requests without it did not come through the Worker.
const SHARED_SECRET_HEADER: &str = "x-scraper-secret";
const SHARED_SECRET_VARIABLE: &str = "SCRAPER_SHARED_SECRET";
const ROUTE: &str = "/scrape/media";

/// The Lambda times out after 10 seconds; the fetch must give up first.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const FETCH_TIMEOUT: Duration = Duration::from_secs(8);
/// Counted after decompression.
const MAX_BODY_BYTES: usize = 5 * 1024 * 1024;

/// File extensions treated as audio or video, lowercase and sorted for binary
/// search. Hand-maintained: the common containers, codecs and playlists.
const MEDIA_EXTENSIONS: &[&str] = &[
    "3g2", "3gp", "aac", "ac3", "aif", "aifc", "aiff", "amr", "asf", "au", "avi", "caf",
    "divx", "dv", "f4v", "flac", "flv", "m1v", "m2t", "m2ts", "m2v", "m3u", "m3u8",
    "m4a", "m4b", "m4p", "m4r", "m4v", "mid", "midi", "mk3d", "mka", "mkv", "mov", "mp2",
    "mp3", "mp4", "mp4v", "mpd", "mpe", "mpeg", "mpg", "mpga", "mts", "oga", "ogg",
    "ogv", "opus", "qt", "ra", "ram", "snd", "spx", "ts", "vob", "wav", "wave", "weba",
    "webm", "wma", "wmv",
];

/// Elements whose link attribute can point at media, plus `<base>`, which
/// changes what relative links resolve against.
const LINK_SELECTOR: &str =
    "a[href], area[href], audio[src], base[href], source[src], track[src], video[src]";

/// The reasons a scrape fails, sent as `{"error": "<snake_case name>"}`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum ErrorCode {
    Forbidden,
    NotFound,
    InvalidRequest,
    InvalidUrl,
    Unreachable,
    NotHtml,
    TooLarge,
}

impl ErrorCode {
    const fn status(self) -> StatusCode {
        match self {
            Self::Forbidden => StatusCode::FORBIDDEN,
            Self::NotFound => StatusCode::NOT_FOUND,
            Self::InvalidRequest | Self::InvalidUrl => StatusCode::BAD_REQUEST,
            Self::Unreachable | Self::NotHtml | Self::TooLarge => StatusCode::BAD_GATEWAY,
        }
    }
}

#[derive(Deserialize)]
struct ScrapeRequest {
    url: String,
}

#[derive(Serialize)]
struct ScrapeResult {
    url: String,
    links: Vec<String>,
}

#[derive(Serialize)]
struct ScrapeError {
    error: ErrorCode,
}

/// Compares without stopping at the first difference, so response timing does
/// not reveal how much of a guess was right.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Only absolute http(s) URLs may be fetched. The Worker checks this too; this
/// copy keeps the Lambda safe on its own.
fn parse_website_url(input: &str) -> Option<Url> {
    let url = Url::parse(input.trim()).ok()?;
    (matches!(url.scheme(), "http" | "https") && url.host_str().is_some()).then_some(url)
}

/// Whether a URL path's last segment has an audio or video extension.
fn is_media_path(path: &str) -> bool {
    let file_name = path.rsplit('/').next().unwrap_or_default();
    file_name.rsplit_once('.').is_some_and(|(_, extension)| {
        MEDIA_EXTENSIONS
            .binary_search(&extension.to_ascii_lowercase().as_str())
            .is_ok()
    })
}

/// A missing `Content-Type` is given the benefit of the doubt.
fn is_html(headers: &HeaderMap) -> bool {
    headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_none_or(|value| {
            let essence = value.split(';').next().unwrap_or_default().trim();
            essence.eq_ignore_ascii_case("text/html")
                || essence.eq_ignore_ascii_case("application/xhtml+xml")
        })
}

/// The `charset` parameter of `Content-Type`, when it names an encoding the
/// tokenizer supports. A `<meta charset>` can still override it.
fn declared_encoding(headers: &HeaderMap) -> Option<AsciiCompatibleEncoding> {
    let value = headers.get(header::CONTENT_TYPE)?.to_str().ok()?;
    let label = value.split(';').skip(1).find_map(|parameter| {
        let (name, label) = parameter.split_once('=')?;
        name.trim()
            .eq_ignore_ascii_case("charset")
            .then(|| label.trim().trim_matches('"'))
    })?;
    AsciiCompatibleEncoding::new(Encoding::for_label(label.as_bytes())?)
}

/// What the tokenizer has found so far.
struct MediaLinks {
    /// The page's URL, until a `<base href>` replaces it.
    base: Url,
    base_seen: bool,
    links: Vec<String>,
    seen: HashSet<String>,
}

impl MediaLinks {
    fn visit(&mut self, element: &Element<'_, '_>) {
        let attribute = match element.tag_name().as_str() {
            "base" => {
                // Only the first <base href> counts, as in a browser.
                if !self.base_seen {
                    self.base_seen = true;
                    if let Some(base) = element
                        .get_attribute("href")
                        .and_then(|href| self.base.join(href.trim()).ok())
                    {
                        self.base = base;
                    }
                }
                return;
            }
            "a" | "area" => "href",
            _ => "src",
        };
        if let Some(link) = element.get_attribute(attribute) {
            self.push(&link);
        }
    }

    /// Keeps a link if it resolves to an http(s) URL with a media extension.
    /// Query strings and fragments are dropped; the first copy of each URL
    /// keeps its place in page order.
    fn push(&mut self, link: &str) {
        let Ok(mut url) = self.base.join(link.trim()) else {
            return;
        };
        // Without this, `javascript:` and `data:` URLs ending in `.mp3` pass.
        if !matches!(url.scheme(), "http" | "https") || !is_media_path(url.path()) {
            return;
        }
        url.set_query(None);
        url.set_fragment(None);
        let url = String::from(url);
        if self.seen.insert(url.clone()) {
            self.links.push(url);
        }
    }
}

const fn discard(_: &[u8]) {}

/// Streams a page through `lol_html`, collecting media links as they pass.
struct MediaLinkParser {
    rewriter: HtmlRewriter<'static, fn(&[u8])>,
    found: Arc<Mutex<MediaLinks>>,
}

impl MediaLinkParser {
    fn new(page_url: Url, encoding: Option<AsciiCompatibleEncoding>) -> Self {
        let found = Arc::new(Mutex::new(MediaLinks {
            base: page_url,
            base_seen: false,
            links: Vec::new(),
            seen: HashSet::new(),
        }));
        let handler_found = Arc::clone(&found);
        let mut settings = Settings::new_send()
            .with_adjust_charset_on_meta_tag(true)
            // Ambiguous markup is parsed as best it can be rather than refused.
            .with_strict(false)
            .append_element_content_handler(element!(LINK_SELECTOR, move |element| {
                handler_found
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .visit(element);
                Ok(())
            }));
        if let Some(encoding) = encoding {
            settings = settings.with_encoding(encoding);
        }
        let sink: fn(&[u8]) = discard;
        Self {
            rewriter: HtmlRewriter::new(settings, sink),
            found,
        }
    }

    fn write(&mut self, chunk: &[u8]) -> Result<(), RewritingError> {
        self.rewriter.write(chunk)
    }

    fn finish(self) -> Result<Vec<String>, RewritingError> {
        self.rewriter.end()?;
        let mut found = self.found.lock().unwrap_or_else(PoisonError::into_inner);
        Ok(std::mem::take(&mut found.links))
    }
}

/// Fetches a page and lists its media links. The result's URL is the page's
/// final URL after redirects, which relative links resolve against.
async fn scrape(client: &reqwest::Client, url: Url) -> Result<ScrapeResult, ErrorCode> {
    let mut response = client
        .get(url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|_| ErrorCode::Unreachable)?;
    if !is_html(response.headers()) {
        return Err(ErrorCode::NotHtml);
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_BODY_BYTES as u64)
    {
        return Err(ErrorCode::TooLarge);
    }

    let final_url = response.url().clone();
    let mut parser =
        MediaLinkParser::new(final_url.clone(), declared_encoding(response.headers()));
    let mut received = 0;
    while let Some(chunk) = response.chunk().await.map_err(|_| ErrorCode::Unreachable)? {
        received += chunk.len();
        if received > MAX_BODY_BYTES {
            return Err(ErrorCode::TooLarge);
        }
        parser.write(&chunk).map_err(|_| ErrorCode::Unreachable)?;
    }
    let links = parser.finish().map_err(|_| ErrorCode::Unreachable)?;
    Ok(ScrapeResult {
        url: final_url.into(),
        links,
    })
}

fn json_response(status: StatusCode, body: &impl Serialize) -> Response<Body> {
    // These types always serialize.
    let mut response =
        Response::new(Body::from(serde_json::to_string(body).unwrap_or_default()));
    *response.status_mut() = status;
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    response
}

fn error_response(error: ErrorCode) -> Response<Body> {
    json_response(error.status(), &ScrapeError { error })
}

struct Scraper {
    shared_secret: String,
    client: reqwest::Client,
}

impl Scraper {
    async fn handle(&self, request: Request) -> Response<Body> {
        let authorized =
            request
                .headers()
                .get(SHARED_SECRET_HEADER)
                .is_some_and(|value| {
                    constant_time_eq(value.as_bytes(), self.shared_secret.as_bytes())
                });
        if !authorized {
            return error_response(ErrorCode::Forbidden);
        }
        if request.method() != Method::POST || request.uri().path() != ROUTE {
            return error_response(ErrorCode::NotFound);
        }
        let Ok(ScrapeRequest { url }) = serde_json::from_slice(request.body()) else {
            return error_response(ErrorCode::InvalidRequest);
        };
        let Some(url) = parse_website_url(&url) else {
            return error_response(ErrorCode::InvalidUrl);
        };
        match scrape(&self.client, url).await {
            Ok(result) => json_response(StatusCode::OK, &result),
            Err(error) => error_response(error),
        }
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Error> {
    // Fail at cold start rather than accept requests without a secret to check.
    let shared_secret = std::env::var(SHARED_SECRET_VARIABLE)
        .ok()
        .filter(|secret| !secret.is_empty())
        .ok_or_else(|| format!("{SHARED_SECRET_VARIABLE} must be set"))?;
    rustls::crypto::ring::default_provider()
        .install_default()
        .map_err(|_| "a TLS crypto provider was already installed")?;
    let client = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(FETCH_TIMEOUT)
        .user_agent(concat!("cloud-web-scraper/", env!("CARGO_PKG_VERSION")))
        .build()?;
    let scraper = Arc::new(Scraper {
        shared_secret,
        client,
    });

    run(service_fn(move |request: Request| {
        let scraper = Arc::clone(&scraper);
        async move { Ok::<_, Error>(scraper.handle(request).await) }
    }))
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn media_links(page: &str, chunks: &[&str]) -> Vec<String> {
        let mut parser = MediaLinkParser::new(Url::parse(page).unwrap(), None);
        for chunk in chunks {
            parser.write(chunk.as_bytes()).unwrap();
        }
        parser.finish().unwrap()
    }

    #[test]
    fn secret_comparison() {
        assert!(constant_time_eq(b"secret", b"secret"));
        assert!(!constant_time_eq(b"secret", b"secreT"));
        assert!(!constant_time_eq(b"secret", b"secret2"));
        assert!(!constant_time_eq(b"", b"secret"));
    }

    #[test]
    fn only_http_urls_are_fetched() {
        assert!(parse_website_url(" https://example.com/page ").is_some());
        assert!(parse_website_url("http://example.com").is_some());
        assert!(parse_website_url("file:///etc/passwd").is_none());
        assert!(parse_website_url("ftp://example.com/a.mp3").is_none());
        assert!(parse_website_url("example.com").is_none());
    }

    #[test]
    fn media_extensions_are_sorted_and_lowercase() {
        assert!(MEDIA_EXTENSIONS.is_sorted());
        assert!(MEDIA_EXTENSIONS.iter().all(|extension| {
            extension
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        }));
        assert!(is_media_path("/a/b.MP3"));
        assert!(is_media_path("/clip.webm"));
        assert!(!is_media_path("/notes.pdf"));
        assert!(!is_media_path("/mp3"));
        assert!(!is_media_path("/"));
    }

    #[test]
    fn media_links_resolve_against_the_page() {
        let links = media_links(
            "https://example.com/shows/episode.html",
            &[r#"
            <a href="/media/a.mp3?token=1">root-relative</a>
            <a href="b.mp4#t=10">page-relative</a>
            <video src="//cdn.example.net/c.webm"></video>
            <audio><source src="https://other.example/d.ogg"></audio>
            <A HREF="/media/a.mp3">duplicate</A>
            <a href="notes.pdf">not media</a>
            <img src="poster.mp4">
            <a href="javascript:alert(1)//e.mp3">script</a>
            <a href="data:text/html,x//f.mp3">data</a>
            <a>no link</a>
        "#],
        );
        assert_eq!(
            links,
            [
                "https://example.com/media/a.mp3",
                "https://example.com/shows/b.mp4",
                "https://cdn.example.net/c.webm",
                "https://other.example/d.ogg",
            ]
        );
    }

    #[test]
    fn first_base_element_changes_resolution() {
        let links = media_links(
            "https://example.com/page.html",
            &[
                r#"<head><base href="https://cdn.example.net/media/"><base href="/ignored/">"#,
                r#"</head><body><a href="a.mp3">a</a></body>"#,
            ],
        );
        assert_eq!(links, ["https://cdn.example.net/media/a.mp3"]);
    }

    #[test]
    fn tags_split_across_chunks_are_found() {
        let links = media_links(
            "https://example.com/",
            &["<p>intro</p><a hr", "ef=\"/a.m", "p3\">a</a>"],
        );
        assert_eq!(links, ["https://example.com/a.mp3"]);
    }

    #[test]
    fn only_html_responses_are_parsed() {
        let mut headers = HeaderMap::new();
        assert!(is_html(&headers));
        headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("Text/HTML; charset=Shift_JIS"),
        );
        assert!(is_html(&headers));
        assert_eq!(
            declared_encoding(&headers)
                .map(|encoding| <&Encoding>::from(encoding).name()),
            Some("Shift_JIS")
        );
        headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("video/mp4"));
        assert!(!is_html(&headers));
        assert!(declared_encoding(&headers).is_none());
    }

    #[test]
    fn errors_serialize_as_snake_case_codes() {
        assert_eq!(
            serde_json::to_string(&ScrapeError {
                error: ErrorCode::TooLarge
            })
            .unwrap(),
            r#"{"error":"too_large"}"#
        );
        assert_eq!(ErrorCode::InvalidUrl.status(), StatusCode::BAD_REQUEST);
    }
}
