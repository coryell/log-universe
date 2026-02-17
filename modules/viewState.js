import * as d3 from 'd3';
import { LANGUAGE, categories, colors, DOUBLE_CLICK_THRESHOLD } from './constants.js';
import { getLocalized, getFilteredData } from './utils.js';

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

    const colorScale = d3.scaleOrdinal().domain(categories).range(colors);

    // --- Plot Update ---
    function updatePlot(options = {}) {
        viz.update(data, {
            currentDimensionX,
            currentDimensionY,
            colorScale,
            language: LANGUAGE,
            categories
        });
        if (!options.skipResetZoom) {
            viz.resetZoom(); // Default view: Center on content
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
            if (event.button === 0) {
                hideInfobox();
                if (viz.ruler) {
                    viz.ruler.clearMark(); // Always clear mark on click

                    // Only hide the ruler cursor itself on mobile
                    if (window.matchMedia('(max-width: 768px)').matches) {
                        viz.ruler.hide();
                    }
                }
            }
        });

        window.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                if (viz.ruler) viz.ruler.clearMark();
                hideInfobox();
            }
        });

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
    }

    // --- Initialize ---
    initDropdowns();
    initEventListeners();

    viz.setCallbacks({
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
    return {
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
}
