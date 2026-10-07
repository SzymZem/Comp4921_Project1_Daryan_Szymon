function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

window.addEventListener("load", function() {
    let fade_element = document.querySelector("body.fade");

    if(fade_element != null) {
        fade_element.classList.remove("fade");
        fade_element.classList.add("fadeIn");
    }
});

let sidebar_opened = false;
let sidebar;

document.addEventListener("DOMContentLoaded", function() {
    underlineIntro(1000, 500);

    sidebar = document.querySelector(".sidebar");

    document.addEventListener("click", sidebarClickListener);
});

function closeSidebar() {
    sidebar.classList.remove("fadeIn");
    sidebar.classList.add("fade");
    sidebar_opened = false;
}

function showSidebar() {
    sidebar.classList.remove("fade");
    sidebar.classList.add("fadeIn");
    sidebar_opened = true;
}

function sidebarClickListener(event) {
    if(!sidebar) {
        return;
    }

    if(event.target.closest(".hamburger")) {
        event.preventDefault();

        if(sidebar_opened) {
            closeSidebar();
        } else {
            showSidebar();
        }
    } else if(sidebar_opened && !sidebar.contains(event.target)) {
        closeSidebar();
    }
}

function underlineIntro(duration_ms, delay_ms = 0) {
    const skip_tags = ["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "SELECT", "OPTION", "TITLE", "svg"];

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            if(!node.textContent.trim() || node.parentElement.closest(skip_tags.join(","))) {
                return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
        }
    });

    let text_nodes = [];
    while(walker.nextNode()) {
        text_nodes.push(walker.currentNode);
    }

    let spans = [];
    let parents = new Set();

    text_nodes.forEach(node => {
        let fragment = document.createDocumentFragment();

        for(const char of node.textContent) {
            if(char.trim() === "") {
                fragment.appendChild(document.createTextNode(char));
            } else {
                let span = document.createElement("span");
                span.className = "intro-char intro-underline";
                span.textContent = char;
                span.style.animationDelay = (-Math.random() * 2.5) + "s";
                span.style.animationDuration = (2 + Math.random()) + "s";
                fragment.appendChild(span);
                spans.push(span);
            }
        }

        parents.add(node.parentNode);
        node.replaceWith(fragment);
    });

    const qr_grid_size = 6;
    let overlays = [];
    let cells = [];

    document.querySelectorAll(".qr-wrap").forEach(wrap => {
        let overlay = document.createElement("div");
        overlay.className = "qr-intro-overlay";
        overlay.style.gridTemplateColumns = "repeat(" + qr_grid_size + ", 1fr)";

        for(let i = 0; i < qr_grid_size * qr_grid_size; i++) {
            let cell = document.createElement("div");
            cell.className = "qr-intro-cell";
            cell.style.animationDelay = (-Math.random() * 2.5) + "s";
            cell.style.animationDuration = (0.5 + Math.random()) + "s";
            overlay.appendChild(cell);
            cells.push(cell);
        }

        wrap.appendChild(overlay);
        overlays.push(overlay);
    });

    let items = spans.concat(cells);

    for(let i = items.length - 1; i > 0; i--) {
        let j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
    }

    let start = null;
    let removed = 0;

    function step(timestamp) {
        if(start === null) {
            start = timestamp;
        }

        let t = Math.min(1, (timestamp - start) / duration_ms);
        let eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        let target = Math.min(items.length, Math.ceil(eased * items.length));

        for(; removed < target; removed++) {
            items[removed].classList.remove("intro-underline", "qr-intro-cell");
        }

        if(removed < items.length) {
            requestAnimationFrame(step);
        } else {
            spans.forEach(span => span.replaceWith(span.textContent));
            parents.forEach(parent => parent.normalize());
            overlays.forEach(overlay => overlay.remove());
        }
    }

    setTimeout(() => requestAnimationFrame(step), delay_ms);
}

let animation_playing = false;

async function error_animation(element_id, times_to_flash, speed_ms) {

    if(animation_playing) {
        return;
    }

    if(speed_ms === undefined || speed_ms <= 0) {
        speed_ms = 350;
    }

    let element = document.getElementById(element_id);

    if(!element) {
        console.error("Could not find element by ID for flashing animation!");
        return;
    }

    let element_previousHTML = element.innerHTML;

    await sleep(5000);
    animation_playing = true;

    times_to_flash = Math.round(times_to_flash + 1);

    for(let i = 1; i <= times_to_flash; i++) {
        element.classList.remove("fadeIn");
        element.classList.add("fade");
        await sleep(speed_ms);

        element.classList.add("combine-red");
        element.innerHTML = "ERROR";

        if(i == times_to_flash) {
            element.innerHTML = element_previousHTML;
            element.classList.remove("combine-red");
        }

        element.classList.remove("fade");
        element.classList.add("fadeIn");
        await sleep(speed_ms);
    }

    animation_playing = false;
}
