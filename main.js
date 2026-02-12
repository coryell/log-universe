import * as d3 from 'd3';
import './style.css';
import { createSearchUI } from './modules/searchUI.js';
import { getFilteredData } from './modules/utils.js';
import { createInfobox } from './modules/infobox.js';
import { createVisualization } from './modules/visualization.js';
import { processData } from './modules/dataProcessor.js';
import { createViewState } from './modules/viewState.js';

// Visualization
const app = document.getElementById('app');
const viz = createVisualization(app, {
  currentDimensionX: "none",
  currentDimensionY: "length"
});

const infobox = createInfobox(d3.select("body"));

d3.json('/data.json').then(rawData => {
  const data = processData(rawData);

  // Initialize view state (owns dimensions, selection, dropdowns, plot updates)
  const viewState = createViewState({ viz, infobox, data });

  // Initialize Search UI
  const searchUI = createSearchUI('#search-input', '#search-results', {
    data: () => data,
    language: 'en-us',
    getFilteredData,
    currentDimensionX: () => viewState.currentDimensionX,
    currentDimensionY: () => viewState.currentDimensionY,
    onSelect: (result) => viewState.selectResult(result),
    onEscape: () => viewState.hideInfobox()
  });

  // Mobile Menu Toggle
  const mobileToggle = document.getElementById('mobile-menu-toggle');
  const controlsWrapper = document.querySelector('.controls-wrapper');
  if (mobileToggle && controlsWrapper) {
    mobileToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      controlsWrapper.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
      if (controlsWrapper.classList.contains('active') &&
        !controlsWrapper.contains(e.target) &&
        e.target !== mobileToggle &&
        !mobileToggle.contains(e.target)) {
        controlsWrapper.classList.remove('active');
      }
    });
  }

  // Gesture-based interactions (zoom, pan, long-press for ruler) are handled 
  // internally in the visualization module, while standard item clicks/taps
  // are relayed via callbacks through the viewState.
});
