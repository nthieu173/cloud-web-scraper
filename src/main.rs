use axum::{
    http::{header, StatusCode},
    response::IntoResponse,
    routing::options,
    Form, Router,
};
use lambda_http::{run, Error};
use mime_guess::from_ext;
use scraper::{Html, Selector};
use serde::Deserialize;
use std::env::var;
use std::sync::OnceLock;
use tera::Tera;
use tokio;
use ureq;

fn tera_templates() -> &'static Tera {
    static TEMPLATES: OnceLock<Tera> = OnceLock::new();
    TEMPLATES.get_or_init(|| {
        let mut tera = Tera::default();
        tera.add_raw_template("bulma-panel.tera", "
        <article class=\"panel is-info\">
            <p class=\"panel-heading\">
                {{website_url}}
            </p>
            {% for name_url in name_urls %}
                <a class=\"panel-block\" href=\"{{name_url.1}}\" target=\"_blank\" download=\"{{name_url.0}}\">
                    {{name_url.0}}
                </a>
            {% endfor %}
        </article>
        ").expect("Failed to add template bulma-panel.tera");
        tera.add_raw_template("bulma-error-card.tera", "
        <div class=\"card\">
            <div class=\"card-content\">
                <div class=\"content\">
                    {{error}}
                </div>
            </div>
        </div>
        ").expect("Failed to add template bulma-error-card.tera");
        tera
    })
}

fn access_control_allow_origin() -> String {
    var("ACCESS_CONTROL_ALLOW_ORIGIN").unwrap_or("".to_string())
}

async fn options_handler() -> impl IntoResponse {
    let headers = [
        (
            header::ACCESS_CONTROL_ALLOW_ORIGIN,
            access_control_allow_origin(),
        ),
        (
            header::ACCESS_CONTROL_ALLOW_METHODS,
            "POST, OPTIONS".to_string(),
        ),
        (
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            "Content-Type".to_string(),
        ),
    ];
    (StatusCode::OK, headers, "")
}

#[derive(Deserialize)]
struct ScrapeForm {
    url: String,
}

fn name_url_list_to_bulma_panel(website_url: &str, name_urls: Vec<(String, String)>) -> String {
    let mut context = tera::Context::new();
    context.insert("website_url", website_url);
    context.insert("name_urls", &name_urls);
    tera_templates()
        .render("bulma-panel.tera", &context)
        .unwrap()
}

fn error_to_bulma_error_card(error: &str) -> String {
    let mut context = tera::Context::new();
    context.insert("error", error);
    tera_templates()
        .render("bulma-error-card.tera", &context)
        .unwrap()
}

async fn scrape_media(Form(params): Form<ScrapeForm>) -> impl IntoResponse {
    let website_url = params.url;

    let headers = [
        (
            header::ACCESS_CONTROL_ALLOW_ORIGIN,
            access_control_allow_origin(),
        ),
        (header::CONTENT_TYPE, "text/html".to_string()),
    ];

    if let Ok(response) = ureq::get(&website_url).call() {
        if response.status() / 100 == 2 {
            if let Ok(body) = response.into_string() {
                let fragment = Html::parse_fragment(&body);
                // We want to check <audio>, <video>, <source>, <track> and <a> tags
                let selector = Selector::parse("audio, video, source, track, a").unwrap();
                let mut name_urls: Vec<(String, String)> = Vec::new();
                for element in fragment.select(&selector) {
                    let tag_name = element.value().name();
                    let url = match tag_name {
                        "audio" | "video" | "source" | "track" => element.value().attr("src"),
                        "a" => element.value().attr("href"),
                        _ => unreachable!(), // We only selected the tags above
                    };
                    // If the url is relative, we need to prepend the base url
                    if let Some(url) = url {
                        // Trim and remove query string
                        let url = url.trim().split('?').next().unwrap_or("");
                        let file_name = url.split('/').last().unwrap_or("");
                        let extension = file_name.split('.').last().unwrap_or("");
                        let mime_type = from_ext(extension).first_or_text_plain();
                        let mime_top_type = mime_type.type_();
                        // If the extension is not audio or video, we skip it
                        if !mime_top_type.as_str().starts_with("audio")
                            && !mime_top_type.as_str().starts_with("video")
                        {
                            continue;
                        }
                        let mut url = url.to_string();
                        // We only want to return unique urls
                        // If the url is not absolute, we need to process it
                        if !url.starts_with("http") {
                            if url.starts_with("//") {
                                // We need to prepend the protocol
                                url.insert_str(0, "https:");
                            } else if url.starts_with("/") {
                                // We need to prepend the base url
                                url.insert_str(0, &website_url);
                            } else {
                                // We need to prepend the base url and a slash
                                url.insert_str(0, &format!("{}/", &website_url));
                            }
                        }
                        let item = (file_name.to_string(), url);
                        // We only want to return unique urls
                        if !name_urls.contains(&item) {
                            // We use this expensive check instead of a HashSet
                            // because we want to preserve the order of the urls
                            name_urls.push(item);
                        }
                    }
                }
                // We return the urls as a json array
                return (
                    StatusCode::OK,
                    headers,
                    name_url_list_to_bulma_panel(&website_url, name_urls),
                );
            }
        }
    }

    (
        StatusCode::BAD_GATEWAY,
        headers,
        error_to_bulma_error_card("Cannot scrape media from this website"),
    )
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    // build our application with a single route
    let app = Router::new().route("/scrape/media", options(options_handler).post(scrape_media));

    run(app).await
}
