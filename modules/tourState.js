export function createTourState({ viz, viewState }) {
    let isActive = false;
    let tourTimeoutId = null;

    function getTourBtn() {
        return document.getElementById('tour-btn');
    }

    function getRandomItem() {
        // Only pick from currently visible, filtered data to avoid panning to empty space
        const currentData = viz.currentState.filteredData;
        if (!currentData || currentData.length === 0) return null;
        const randomIndex = Math.floor(Math.random() * currentData.length);
        return currentData[randomIndex];
    }

    function scheduleNextTourStop() {
        if (!isActive) return;

        const nextItem = getRandomItem();
        if (!nextItem) {
            stopTour();
            return;
        }

        // 1. Zoom and pan slowly to the item (4 seconds)
        viz.zoomToItem(nextItem, false, 4000);

        // Wait for zoom to finish, then show infobox and wait
        tourTimeoutId = setTimeout(() => {
            if (!isActive) return;

            // Show infobox for the item (showInfobox handles highlighting internally)
            viewState.showInfobox(nextItem);

            // 2. Wait 5 seconds to let the user read/view
            tourTimeoutId = setTimeout(() => {
                if (!isActive) return;
                viewState.hideInfobox();

                // 3. Loop: pick next point
                tourTimeoutId = setTimeout(scheduleNextTourStop, 500);
            }, 10000);

        }, 4000);
    }

    function startTour() {
        if (isActive) return;
        isActive = true;

        const btn = getTourBtn();
        if (btn) {
            btn.classList.add('active');
            btn.textContent = 'Stop Tour';
        }

        viewState.hideInfobox();
        scheduleNextTourStop();
    }

    function stopTour() {
        if (!isActive) return;
        isActive = false;

        if (tourTimeoutId) {
            clearTimeout(tourTimeoutId);
            tourTimeoutId = null;
        }

        const btn = getTourBtn();
        if (btn) {
            btn.classList.remove('active');
            btn.textContent = 'Tour';
        }
    }

    function toggleTour() {
        if (isActive) {
            stopTour();
        } else {
            startTour();
        }
    }

    const state = {
        get isActive() { return isActive; },
        startTour,
        stopTour,
        toggleTour
    };

    // Bind click after DOM is ready via setTimeout(0)
    setTimeout(() => {
        const btn = getTourBtn();
        if (btn) {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleTour();
            });
        }
    }, 0);

    return state;
}
