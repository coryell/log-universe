import * as d3 from 'd3';
import { LANGUAGE, categories, DOUBLE_CLICK_THRESHOLD, checkMobile, checkTouch } from './constants.js';
import { getLocalized, getFilteredData } from './utils.js';
import { createTourState } from './tourState.js';

/**
 * Creates and manages the application's view state:
 * - Which dimensions are active (X and Y)
 * - Which item is selected (infobox)
 * - Dropdown bindings
 * - Plot update orchestration
 */
export function createViewState({ viz, infobox, data }) {
    let currentDimensionX = "none";
    let currentDimensionY = "length";
    let selectedItem = null;
    let currentPositionMode = 'bottom'; // Track position mode

    const categoryNames = Object.keys(categories);
    const categoryColors = categoryNames.map(name => categories[name].color);
    const colorScale = d3.scaleOrdinal().domain(categoryNames).range(categoryColors);

    // --- Plot Update ---
    function updatePlot(options = {}) {
        viz.update(data, {
            currentDimensionX,
            currentDimensionY,
            colorScale,
            language: LANGUAGE,
            categories: categoryNames
        });
        if (!options.skipResetZoom) {
            viz.resetZoom(); // Default view: Center on content
        }

        // Re-apply selection if it's still valid in the new view
        if (selectedItem) {
            const currentVisItem = viz.getCurrentItem(selectedItem);

            if (currentVisItem) {
                // If it was a cluster that broke apart, we have to update the selectedItem to its new form (a single point).
                // If it was a single point that got clustered, the user wants the infobox to still show the single point.
                let nextItem = selectedItem;
                if (selectedItem._isCombined) {
                    nextItem = currentVisItem;
                } else {
                    // It was a specific point. Ensure it still has valid dimensions in the new view.
                    const hasX = currentDimensionX === "none" || selectedItem.dimensions[currentDimensionX] !== undefined;
                    const hasY = selectedItem.dimensions[currentDimensionY] !== undefined;
                    if (!hasX || !hasY) {
                        nextItem = null;
                    }
                }

                if (nextItem) {
                    selectedItem = nextItem;
                    viz.highlightItem(currentVisItem); // Highlight the cluster visually
                    infobox.show(selectedItem, {       // But show the specific point in the infobox
                        currentDimensionX,
                        currentDimensionY,
                        colorScale,
                        language: LANGUAGE,
                        positionMode: currentPositionMode
                    });
                } else {
                    hideInfobox();
                }
            } else {
                hideInfobox();
            }
        }
    }


    // --- Selection / Infobox ---
    function showInfobox(d, options = {}) {
        selectedItem = d;
        if (options.positionMode) {
            currentPositionMode = options.positionMode;
        }

        viz.highlightItem(d);
        infobox.show(d, {
            currentDimensionX,
            currentDimensionY,
            colorScale,
            language: LANGUAGE,
            positionMode: currentPositionMode
        });
    }

    function hideInfobox() {
        infobox.hide();
        viz.unhighlightItems();
        selectedItem = null;
    }

    function selectResult(result, options = {}) {
        if (result.dimensions[currentDimensionY] === undefined) return;
        if (currentDimensionX !== "none" && result.dimensions[currentDimensionX] === undefined) return;

        // Clear green mark logic on all devices.
        // Hide red ruler cursor ONLY on mobile.
        const isTouch = checkTouch();
        if (viz.ruler) {
            viz.ruler.clearMark();
            if (isTouch) {
                viz.ruler.hide();
            }
        }

        viz.zoomToItem(result);
        if (options.preservePosition) {
            showInfobox(result); // Use currentPositionMode
        } else {
            showInfobox(result, { positionMode: 'bottom' }); // Reset to bottom for search/default
        }
    }

    // --- Hash Management ---
    function updateHash() {
        if (currentDimensionX === "none") {
            window.location.hash = currentDimensionY;
        } else {
            window.location.hash = `${currentDimensionY}-${currentDimensionX}`;
        }
    }

    function readHash() {
        const hash = window.location.hash.substring(1); // remove '#'
        if (!hash) return;

        const parts = hash.split('-');
        if (parts.length >= 2) {
            // Handle cases like "length-mass" -> Y=length, X=mass
            // But what if a dimension name has a hyphen? Assuming not for now.
            // If we have > 2 parts, it might be ambiguous, but let's assume simple split.
            // safely separate last part as X?
            // Actually, dimensions are clean single words usually (length, mass, duration, etc).
            currentDimensionY = parts[0];
            currentDimensionX = parts[1];
        } else if (parts.length === 1 && parts[0]) {
            currentDimensionY = parts[0];
            currentDimensionX = "none";
        }
    }

    // --- Dropdown Initialization ---
    function initDropdowns() {
        // Initialize from Hash checks first
        readHash();

        d3.select('#dimension-select-y').property('value', currentDimensionY);
        d3.select('#dimension-select-x').property('value', currentDimensionX);

        d3.select('#dimension-select-y').on('change', function () {
            currentDimensionY = this.value;
            updateHash();
            updatePlot();
        });

        d3.select('#dimension-select-x').on('change', function () {
            currentDimensionX = this.value;
            updateHash();
            updatePlot();
        });

        d3.select('#recenter-btn').on('click', () => {
            viz.resetZoom();
        });

        // Also update hash immediately in case we loaded defaults but URL was empty?
        // Or only on change? User asked to "add a # part", implies reflecting current state.
        // If URL is empty, we might want to set Default.
        if (!window.location.hash) {
            updateHash();
        }
    }

    // Define public API first so we can pass it to tourState
    const publicApi = {
        get currentDimensionX() { return currentDimensionX; },
        get currentDimensionY() { return currentDimensionY; },
        get selectedItem() { return selectedItem; },
        get colorScale() { return colorScale; },
        showInfobox,
        hideInfobox,
        selectResult,
        updatePlot,
        getFilteredData: (matches) => getFilteredData(matches, currentDimensionX, currentDimensionY)
    };

    const tour = createTourState({ viz, viewState: publicApi });

    // --- Global Event Listeners ---
    function initEventListeners() {
        // Listen for hash changes (e.g. back button)
        window.addEventListener("hashchange", () => {
            readHash();
            // Update dropdowns to match new state
            d3.select('#dimension-select-y').property('value', currentDimensionY);
            d3.select('#dimension-select-x').property('value', currentDimensionX);
            updatePlot();
        });

        window.addEventListener("click", (event) => {
            // We want to dismiss selection if clicking on the background.
            // The background could be the <svg> itself, or a background <rect>.
            // We DO NOT want to dismiss if clicking on:
            // 1. Controls (select-container)
            // 2. Data Points (.item-group)
            // 3. Legend (.legend or .mobile-legend-item)
            // 4. Modal overlay

            if (event.target.closest('.select-container') ||
                event.target.closest('.item-group') ||
                event.target.closest('.legend') ||
                event.target.closest('.mobile-legend-item') ||
                event.target.id === 'about-overlay' ||
                event.target.closest('#about-modal')) {
                return;
            }
            if (event.button === 0) {
                hideInfobox();
                if (viz.ruler) {
                    viz.ruler.clearMark(); // Always clear mark on click

                    // Only hide the ruler cursor itself on mobile
                    if (checkTouch()) {
                        viz.ruler.hide();
                    }
                }
            }
        });

        window.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                // Highest priority: Close about modal if open
                const aboutOverlay = document.getElementById('about-overlay');
                if (aboutOverlay && aboutOverlay.style.display !== 'none') {
                    aboutOverlay.style.display = 'none';
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    return;
                }

                if (viz.ruler) viz.ruler.clearMark();
                hideInfobox();
            }
        }, { capture: true });

        window.addEventListener('resize', () => {
            viz.resize();
        });

        const handleOrientationChange = () => {
            // Hide visualization immediately to cover layout snapping
            d3.select('#app').style('opacity', 0);
            // Force a second resize after delay for rotation animation to settle
            setTimeout(() => {
                viz.resize();
                d3.select('#app').style('opacity', 1);
            }, 300);
        };

        if (screen.orientation) {
            screen.orientation.addEventListener('change', handleOrientationChange);
        } else {
            // Fallback for older browsers
            window.addEventListener('orientationchange', handleOrientationChange);
        }

        // Interrupt tour on manual user interaction + inactivity auto-start
        const INACTIVITY_TIMEOUT = 30000; // 30 seconds
        let inactivityTimerId = null;

        function resetInactivityTimer() {
            clearTimeout(inactivityTimerId);
            inactivityTimerId = setTimeout(() => {
                if (!tour.isActive) {
                    tour.startTour();
                }
            }, INACTIVITY_TIMEOUT);
        }

        const stopTourEvents = ['mousedown', 'touchstart', 'wheel', 'keydown', 'pointerdown'];
        stopTourEvents.forEach(evt => {
            window.addEventListener(evt, (e) => {
                // Ignore if it's the tour button itself or inside it
                if (e.target.closest && e.target.closest('#tour-btn')) return;
                tour.stopTour();
                resetInactivityTimer();
            }, { capture: true });
        });

        // Also reset on mousemove (activity without clicking)
        window.addEventListener('mousemove', resetInactivityTimer);

        // Start the initial inactivity timer
        resetInactivityTimer();
    }

    // --- Initialize ---
    initDropdowns();
    initEventListeners();

    viz.setCallbacks({
        onCategoryClick: () => {
            hideInfobox();
        },
        onClick: (event, d) => {
            // Visual feedback is immediate
            viz.highlightItem(d);

            // On mobile, if click is in bottom 40% of screen (where infobox appears), delay showing it
            // but now that it repositions to top, we don't need delay.
            // Note: event might be a D3 event or native event.
            // Visualization passes 'event' which is the D3 event wrapper, event.clientY should exist on sourceEvent or directly?
            // In visualization.js: callbacks.onClick(event, d). 'event' is the DOM event usually.
            const clientY = event.clientY || (event.sourceEvent ? event.sourceEvent.clientY : 0);
            // Determine position mode: if click is in bottom half (approx), show info at top
            const positionMode = clientY > window.innerHeight * 0.5 ? 'top' : 'bottom';

            showInfobox(d, { positionMode });
        },
        onDblClick: (event, d) => {
            selectResult(d, { preservePosition: true });
        }
    });

    updatePlot({ skipResetZoom: true });


    // --- Public API ---
    return publicApi;
}
