use std::fmt::Write as _;
use std::sync::Arc;
use std::time::Duration;

use axum::{
    Form, Router,
    extract::State,
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::post,
};
use lambda_http::{Error, run};
use mime_guess::{from_ext, mime};
use scraper::Html;
use serde::Deserialize;
use ureq::ResponseExt;
use url::Url;

/// Header the Cloudflare Worker adds to every request it forwards. The function
/// URL is public, so requests without it did not come through the Worker.
const SHARED_SECRET_HEADER: &str = "x-scraper-secret";
const SHARED_SECRET_VARIABLE: &str = "SCRAPER_SHARED_SECRET";

/// The Lambda times out after 10 seconds; the fetch must give up first.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const FETCH_TIMEOUT: Duration = Duration::from_secs(8);
const MAX_BODY_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Clone)]
struct AppState {
    shared_secret: Arc<str>,
    agent: ureq::Agent,
}

/// Compares without stopping at the first difference, so response timing does
/// not reveal how much of a guess was right.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Escapes text for HTML element content and quoted attribute values. Page
/// URLs and link names come from the scraped site, so they are untrusted.
fn escape_html(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for character in text.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            _ => escaped.push(character),
        }
    }
    escaped
}

/// The htmx fragment listing a page's media files.
fn media_panel(website_url: &str, name_urls: &[(String, String)]) -> String {
    let mut html = format!(
        "<article class=\"panel is-info\">\n<p class=\"panel-heading\">{}</p>\n",
        escape_html(website_url)
    );
    for (name, url) in name_urls {
        let (name, url) = (escape_html(name), escape_html(url));
        // Writing to a String cannot fail.
        let _ = writeln!(
            html,
            "<a class=\"panel-block\" href=\"{url}\" target=\"_blank\" rel=\"noopener noreferrer\" download=\"{name}\">{name}</a>"
        );
    }
    html.push_str("</article>\n");
    html
}

fn html_response(status: StatusCode, html: String) -> Response {
    (
        status,
        [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
        html,
    )
        .into_response()
}

fn error_response(status: StatusCode, error: &str) -> Response {
    html_response(
        status,
        format!(
            "<div class=\"card\">\n<div class=\"card-content\">\n<div class=\"content\">{}</div>\n</div>\n</div>\n",
            escape_html(error)
        ),
    )
}

/// Only absolute http(s) URLs may be fetched.
fn parse_website_url(input: &str) -> Option<Url> {
    let url = Url::parse(input.trim()).ok()?;
    (matches!(url.scheme(), "http" | "https") && url.host_str().is_some()).then_some(url)
}

/// Lists the audio and video files linked from a page, in page order and
/// without duplicates. Relative links resolve against `base`, the page's final
/// URL after redirects. Query strings are dropped from the returned links.
fn media_links(base: &Url, body: &str) -> Vec<(String, String)> {
    let fragment = Html::parse_fragment(body);
    let mut name_urls: Vec<(String, String)> = Vec::new();
    for element in fragment.root_element().descendent_elements() {
        let element = element.value();
        let link = match element.name() {
            "a" => element.attr("href"),
            "audio" | "video" | "source" | "track" => element.attr("src"),
            _ => continue,
        };
        let Some(link) = link else { continue };
        let link = link.trim().split('?').next().unwrap_or("");
        let file_name = link.rsplit('/').next().unwrap_or("");
        let extension = file_name.rsplit('.').next().unwrap_or("");
        let mime_type = from_ext(extension).first_or_text_plain();
        if mime_type.type_() != mime::AUDIO && mime_type.type_() != mime::VIDEO {
            continue;
        }
        let Ok(absolute) = base.join(link) else {
            continue;
        };
        let item = (file_name.to_owned(), absolute.to_string());
        // A Vec instead of a HashSet keeps the page's order.
        if !name_urls.contains(&item) {
            name_urls.push(item);
        }
    }
    name_urls
}

#[derive(Deserialize)]
struct ScrapeForm {
    url: String,
}

async fn scrape_media(
    State(state): State<AppState>,
    headers: HeaderMap,
    Form(params): Form<ScrapeForm>,
) -> Response {
    let authorized = headers.get(SHARED_SECRET_HEADER).is_some_and(|value| {
        constant_time_eq(value.as_bytes(), state.shared_secret.as_bytes())
    });
    if !authorized {
        return error_response(StatusCode::FORBIDDEN, "Forbidden");
    }

    let Some(website_url) = parse_website_url(&params.url) else {
        return error_response(
            StatusCode::BAD_REQUEST,
            "Only http and https URLs can be scraped",
        );
    };

    // Non-2xx statuses are errors too.
    let Ok(mut response) = state.agent.get(website_url.as_str()).call() else {
        return error_response(
            StatusCode::BAD_GATEWAY,
            "Cannot scrape media from this website",
        );
    };
    let final_url = Url::parse(&response.get_uri().to_string())
        .unwrap_or_else(|_| website_url.clone());

    let body = match response
        .body_mut()
        .with_config()
        .limit(MAX_BODY_BYTES)
        .lossy_utf8(true)
        .read_to_string()
    {
        Ok(body) => body,
        Err(ureq::Error::BodyExceedsLimit(_)) => {
            return error_response(
                StatusCode::BAD_GATEWAY,
                "This page is too large to scrape",
            );
        }
        Err(_) => {
            return error_response(
                StatusCode::BAD_GATEWAY,
                "Cannot scrape media from this website",
            );
        }
    };

    let name_urls = media_links(&final_url, &body);
    html_response(
        StatusCode::OK,
        media_panel(website_url.as_str(), &name_urls),
    )
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    // Fail at cold start rather than accept requests without a secret to check.
    let shared_secret = std::env::var(SHARED_SECRET_VARIABLE)
        .ok()
        .filter(|secret| !secret.is_empty())
        .ok_or_else(|| format!("{SHARED_SECRET_VARIABLE} must be set"))?;
    let state = AppState {
        shared_secret: shared_secret.into(),
        agent: ureq::Agent::config_builder()
            .timeout_connect(Some(CONNECT_TIMEOUT))
            .timeout_global(Some(FETCH_TIMEOUT))
            .build()
            .into(),
    };

    let app = Router::new()
        .route("/scrape/media", post(scrape_media))
        .with_state(state);
    run(app).await
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn media_links_resolve_against_the_page() {
        let base = Url::parse("https://example.com/shows/episode.html").unwrap();
        let body = r#"
            <a href="/media/a.mp3?token=1">root-relative</a>
            <a href="b.mp4">page-relative</a>
            <video src="//cdn.example.net/c.webm"></video>
            <audio><source src="https://other.example/d.ogg"></audio>
            <a href="/media/a.mp3">duplicate</a>
            <a href="notes.pdf">not media</a>
            <img src="poster.mp4">
            <a>no link</a>
        "#;
        assert_eq!(
            media_links(&base, body),
            vec![
                ("a.mp3".into(), "https://example.com/media/a.mp3".into()),
                ("b.mp4".into(), "https://example.com/shows/b.mp4".into()),
                ("c.webm".into(), "https://cdn.example.net/c.webm".into()),
                ("d.ogg".into(), "https://other.example/d.ogg".into()),
            ]
        );
    }

    #[test]
    fn panel_escapes_scraped_text() {
        let html = media_panel(
            "https://example.com/?q=<script>",
            &[("a\".mp3".into(), "https://example.com/a\".mp3".into())],
        );
        assert!(!html.contains("<script>"));
        assert!(html.contains("&lt;script&gt;"));
        assert!(html.contains("href=\"https://example.com/a&quot;.mp3\""));
        assert!(html.contains("download=\"a&quot;.mp3\""));
    }
}
