document.addEventListener("DOMContentLoaded", () => {
    // Allow the hamburger menu to work on mobile.
    for (const burger of document.querySelectorAll(".navbar-burger")) {
        burger.addEventListener("click", () => {
            burger.classList.toggle("is-active");
            document.getElementById(burger.dataset.target).classList.toggle("is-active");
        });
    }

    const form = document.getElementById("website-url-form");
    const input = document.getElementById("website-url-input");
    const button = document.getElementById("scrape-submit-button");

    // htmx has read the form's values by now, so disabling the input is safe.
    form.addEventListener("htmx:beforeRequest", () => {
        input.disabled = true;
        button.disabled = true;
        button.classList.add("is-loading");
    });
    // Fires after success, error statuses and network failures alike.
    form.addEventListener("htmx:afterRequest", () => {
        input.disabled = false;
        button.disabled = false;
        button.classList.remove("is-loading");
    });

    // htmx drops 4xx/5xx responses by default; the scraper's are error cards
    // meant to be shown.
    form.addEventListener("htmx:beforeSwap", (event) => {
        const { xhr } = event.detail;
        if (xhr.status >= 400 && (xhr.getResponseHeader("content-type") ?? "").startsWith("text/html")) {
            event.detail.shouldSwap = true;
            event.detail.isError = false;
        }
    });
});
