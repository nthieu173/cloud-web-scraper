// Allow the hamburger menu to work on mobile
document.addEventListener('DOMContentLoaded', () => {

    // Get all "navbar-burger" elements
    const $navbarBurgers = Array.prototype.slice.call(document.querySelectorAll('.navbar-burger'), 0);

    // Add a click event on each of them
    $navbarBurgers.forEach(el => {
        el.addEventListener('click', () => {

            // Get the target from the "data-target" attribute
            const target = el.dataset.target;
            const $target = document.getElementById(target);

            // Toggle the "is-active" class on both the "navbar-burger" and the "navbar-menu"
            el.classList.toggle('is-active');
            $target.classList.toggle('is-active');

        });
    });

    document.getElementById("website-url-form").addEventListener("submit", (event) => {
        disableForm();
        document.getElementById("scrape-submit-button").classList.add("is-loading");
    });

    const observer = new MutationObserver(() => {
        enableForm(false);
    });

    observer.observe(document.getElementById("media-container"), {
        childList: true,
    });

});

function disableForm(value) {
    document.getElementById("website-url-input").setAttribute("disabled", true);
    let button = document.getElementById("scrape-submit-button");
    button.setAttribute("disabled", true);
    button.classList.remove("is-loading");
}

function enableForm(value) {
    document.getElementById("website-url-input").removeAttribute("disabled");
    let button = document.getElementById("scrape-submit-button");
    button.removeAttribute("disabled");
    button.classList.remove("is-loading");
}