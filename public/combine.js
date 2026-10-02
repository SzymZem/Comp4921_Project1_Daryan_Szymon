function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

window.addEventListener("load", function() {
    // Fade the page in once everything has loaded
    let fade_element = document.querySelector("body.fade");

    if(fade_element != null) {
        fade_element.classList.remove("fade");
        fade_element.classList.add("fadeIn");
    }
});

let sidebar_opened = false;
let sidebar;

document.addEventListener("DOMContentLoaded", function() {
    underlineIntro(750);

    sidebar = document.querySelector(".sidebar");

    // Add the event listener to listen for clicks on the hamburger button
    document.addEventListener("click", sidebarClickListener);
});

function closeSidebar() {
    // Do the fade out animation
    sidebar.classList.remove("fadeIn");
    sidebar.classList.add("fade");
    sidebar_opened = false;
}

function showSidebar() {
    // Do the fade in animation!
    sidebar.classList.remove("fade");
    sidebar.classList.add("fadeIn");
    sidebar_opened = true;
}

function sidebarClickListener(event) {
    if(!sidebar) {
        return;
    }

    // If the thing pressed is the hamburger button OR an outside element with the sidebar opened
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

// Underline every character on the page, then take the underlines off one at a time
// in a random order over duration_ms. Each character gets its own span for the
// animation, and the spans are unwrapped at the end so the page's HTML is back to normal
function underlineIntro(duration_ms) {
    // Text inside these can't hold spans, or is not visible text
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

    // Swap each text node for one span per character (whitespace stays plain text)
    text_nodes.forEach(node => {
        let fragment = document.createDocumentFragment();

        for(const char of node.textContent) {
            if(char.trim() === "") {
                fragment.appendChild(document.createTextNode(char));
            } else {
                let span = document.createElement("span");
                span.className = "intro-char intro-underline";
                span.textContent = char;
                fragment.appendChild(span);
                spans.push(span);
            }
        }

        parents.add(node.parentNode);
        node.replaceWith(fragment);
    });

    // Fisher-Yates shuffle so the underlines come off in a random order
    for(let i = spans.length - 1; i > 0; i--) {
        let j = Math.floor(Math.random() * (i + 1));
        [spans[i], spans[j]] = [spans[j], spans[i]];
    }

    let start = null;
    let removed = 0;

    function step(timestamp) {
        if(start === null) {
            start = timestamp;
        }

        // How many underlines should be gone by now
        let target = Math.min(spans.length, Math.ceil((timestamp - start) / duration_ms * spans.length));

        for(; removed < target; removed++) {
            spans[removed].classList.remove("intro-underline");
        }

        if(removed < spans.length) {
            requestAnimationFrame(step);
        } else {
            // Put the plain text back and merge the pieces into single text nodes again
            spans.forEach(span => span.replaceWith(span.textContent));
            parents.forEach(parent => parent.normalize());
        }
    }

    requestAnimationFrame(step);
}

let animation_playing = false;

// Error flash animation
async function error_animation(element_id, times_to_flash, speed_ms) {

    if(animation_playing) {
        return;
    }

    if(speed_ms === undefined || speed_ms <= 0) {
        speed_ms = 350;
    }

    // Try to find the element specified by the function
    let element = document.getElementById(element_id);

    if(!element) {
        console.error("Could not find element by ID for flashing animation!");
        return;
    }

    let element_previousHTML = element.innerHTML;

    animation_playing = true;

    times_to_flash = Math.round(times_to_flash + 1);

    // Flash animation
    for(let i = 1; i <= times_to_flash; i++) {
        element.classList.remove("fadeIn");
        element.classList.add("fade");
        await sleep(speed_ms);

        element.classList.add("combine-red");
        element.innerHTML = "ERROR";

        if(i == times_to_flash) {
            // Set the element back to it's previous state for the final cycle
            element.innerHTML = element_previousHTML;
            element.classList.remove("combine-red");
        }

        element.classList.remove("fade");
        element.classList.add("fadeIn");
        await sleep(speed_ms);
    }

    animation_playing = false;
}
