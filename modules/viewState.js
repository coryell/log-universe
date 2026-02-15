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

    const colorScale = d3.scaleOrdinal().domain(categories).range(colors);

    // --- Plot Update ---
    function updatePlot() {
        viz.update(data, {
            currentDimensionX,
            currentDimensionY,
            colorScale,
            language: LANGUAGE,
            categories
        });
        viz.resetZoom(); // Default view: Center on content
    }

    // --- Selection / Infobox ---
    function showInfobox(d) {
        selectedItem = d;
        viz.highlightItem(d);
        infobox.show(d, {
            currentDimensionX,
            currentDimensionY,
            colorScale,
            language: LANGUAGE
        });
    }

    function hideInfobox() {
        infobox.hide();
        viz.unhighlightItems();
        selectedItem = null;
    }

    function selectResult(result) {
        if (result.dimensions[currentDimensionY] === undefined) return;
        if (currentDimensionX !== "none" && result.dimensions[currentDimensionX] === undefined) return;

        viz.zoomToItem(result);
        showInfobox(result);
    }

    // --- Dropdown Initialization ---
    function initDropdowns() {
        d3.select('#dimension-select-y').property('value', currentDimensionY);
        d3.select('#dimension-select-x').property('value', currentDimensionX);

        d3.select('#dimension-select-y').on('change', function () {
            currentDimensionY = this.value;
            updatePlot();
        });

        d3.select('#dimension-select-x').on('change', function () {
            currentDimensionX = this.value;
            updatePlot();
        });

        d3.select('#recenter-btn').on('click', () => {
            viz.resetZoom();
        });
    }

    // --- Global Event Listeners ---
    function initEventListeners() {
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
    }

    // --- Initialize ---
    initDropdowns();
    initEventListeners();

    let infoboxTimeout = null;

    viz.setCallbacks({
        onClick: (event, d) => {
            // Visual feedback is immediate
            viz.highlightItem(d);

            // On mobile, if click is in bottom 40% of screen (where infobox appears), delay showing it
            // to allow for double-click to register first.
            const isMobile = window.matchMedia('(max-width: 768px)').matches;

            // Note: event might be a D3 event or native event. 
            // Visualization passes 'event' which is the D3 event wrapper, event.clientY should exist on sourceEvent or directly?
            // D3 v6+ passes standard PointerEvent as first arg, or specific D3 event?
            // In visualization.js: callbacks.onClick(event, d). 'event' is the DOM event usually.
            const clientY = event.clientY || (event.sourceEvent ? event.sourceEvent.clientY : 0);
            const isBottomRegion = clientY > window.innerHeight * 0.6;

            if (isMobile && isBottomRegion) {
                // Clear any existing timeout
                if (infoboxTimeout) clearTimeout(infoboxTimeout);

                infoboxTimeout = setTimeout(() => {
                    showInfobox(d);
                    infoboxTimeout = null;
                }, DOUBLE_CLICK_THRESHOLD + 50); // Slight buffer over threshold
            } else {
                showInfobox(d);
            }
        },
        onDblClick: (event, d) => {
            if (infoboxTimeout) {
                clearTimeout(infoboxTimeout);
                infoboxTimeout = null;
            }
            selectResult(d);
        }
    });

    updatePlot();

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
