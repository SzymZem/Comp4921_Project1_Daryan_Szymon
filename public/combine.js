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
