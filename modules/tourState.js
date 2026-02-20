import { getLocalized } from './utils.js';
import { LANGUAGE } from './constants.js';

export function createTourState({ viz, viewState }) {
    let isActive = false;
    let tourTimeoutId = null;

    // Round-robin state for category and point selection
    let categoryQueue = [];        // shuffled list of category names still to visit
    let pointQueues = new Map();   // categoryName -> shuffled array of points still to visit

    function getTourBtn() {
        return document.getElementById('tour-btn');
    }

    /** Fisher-Yates shuffle (in place) */
    function shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    /**
     * Build a map of category -> visible points from the current filtered data.
     * Returns a Map<string, Array<item>>.
     */
    function buildCategoryMap() {
        const currentData = viz.currentState.filteredData;
        if (!currentData || currentData.length === 0) return new Map();

        const map = new Map();
        for (const item of currentData) {
            const cat = getLocalized(item.category, LANGUAGE);
            if (!map.has(cat)) map.set(cat, []);
            map.get(cat).push(item);
        }
        return map;
    }

    /**
     * Get the next tour item using round-robin categories without replacement.
     * 1. If categoryQueue is empty, reshuffle all visible categories.
     * 2. Pop the next category from the queue.
     * 3. If that category's pointQueue is empty, reshuffle its visible points.
     * 4. Pop the next point from the queue.
     * 5. If the point isn't currently visible (data changed), skip and try next.
     */
    function getNextItem() {
        const catMap = buildCategoryMap();
        if (catMap.size === 0) return null;

        // Refill category queue if empty
        if (categoryQueue.length === 0) {
            categoryQueue = shuffle([...catMap.keys()]);
        }

        // Try each category in the queue until we find a valid point
        let attempts = categoryQueue.length;
        while (attempts > 0) {
            const cat = categoryQueue.shift();
            attempts--;

            const visiblePoints = catMap.get(cat);
            if (!visiblePoints || visiblePoints.length === 0) {
                // Category has no visible points in current view, skip it
                continue;
            }

            // Get or create the point queue for this category
            if (!pointQueues.has(cat) || pointQueues.get(cat).length === 0) {
                // Reshuffle all visible points for this category
                pointQueues.set(cat, shuffle([...visiblePoints]));
            }

            const queue = pointQueues.get(cat);

            // Find a point that's still in the visible data
            while (queue.length > 0) {
                const candidate = queue.shift();
                // Verify it's still visible
                if (visiblePoints.some(p => p.id === candidate.id)) {
                    return candidate;
                }
            }

            // All points in queue were stale, reshuffle and try once more
            pointQueues.set(cat, shuffle([...visiblePoints]));
            const retryQueue = pointQueues.get(cat);
            if (retryQueue.length > 0) {
                return retryQueue.shift();
            }
        }

        return null;
    }

    function scheduleNextTourStop() {
        if (!isActive) return;

        const nextItem = getNextItem();
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

            // 2. Wait 10 seconds to let the user read/view
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

        // Reset selection state
        categoryQueue = [];
        pointQueues = new Map();

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
