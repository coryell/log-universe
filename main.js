// Copyright (c) 2026 Cutter Coryell
// SPDX-License-Identifier: MIT

import * as d3 from 'd3';
import './style.css';
import { createSearchUI } from './modules/searchUI.js';
import { getFilteredData } from './modules/utils.js';
import { DOUBLE_CLICK_THRESHOLD } from './modules/constants.js';

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

d3.json(`${import.meta.env.BASE_URL}data.json`).then(rawData => {
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
    // Toggle button
    mobileToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      controlsWrapper.classList.toggle('active');
    });

    // Clicks inside the menu should NOT close it (stop bubbling)
    controlsWrapper.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
    });

    // Any pointerdown outside the menu and toggle closes it
    document.addEventListener('pointerdown', (e) => {
      if (controlsWrapper.classList.contains('active') &&
        e.target !== mobileToggle &&
        !mobileToggle.contains(e.target)) {
        controlsWrapper.classList.remove('active');
      }
    });

    // Explicit close on recenter and legend clicks
    const recenterBtn = document.getElementById('recenter-btn');
    if (recenterBtn) {
      recenterBtn.addEventListener('click', () => controlsWrapper.classList.remove('active'));
    }

    const mobileLegend = document.getElementById('mobile-legend');
    if (mobileLegend) {
      mobileLegend.addEventListener('click', (e) => {
        if (e.target.classList.contains('mobile-legend-item')) {
          controlsWrapper.classList.remove('active');
        }
      });
    }
  }

  // About Modal
  const aboutOverlay = document.getElementById('about-overlay');
  const pageTitle = document.getElementById('page-title');
  const aboutClose = document.getElementById('about-close');

  if (pageTitle && aboutOverlay) {
    pageTitle.addEventListener('click', (e) => {
      e.stopPropagation();
      aboutOverlay.style.display = 'flex';
    });

    aboutClose.addEventListener('click', () => {
      aboutOverlay.style.display = 'none';
    });

    aboutOverlay.addEventListener('click', (e) => {
      if (e.target === aboutOverlay) {
        aboutOverlay.style.display = 'none';
      }
    });
  }

  // Reveal the body now that initialization is complete
  document.body.style.opacity = '1';

  // Trigger the initial zoom-out animation (from 10x to fit) only after reveal
  // Trigger the initial zoom-out animation (from 10x to fit) only after reveal
  // Removed delay to ensure immediate transition on mobile
  // Ensure we start at the top to prevent header clipping
  window.scrollTo(0, 0);
  viewState.updatePlot();
});



// Global Prevention of Browser-Level Zooming (Desktop Pinch)
window.addEventListener('wheel', (e) => {
  if (e.ctrlKey) {
    e.preventDefault();
  }
}, { passive: false });

// Prevent multi-touch gestures on the window that might trigger browser zoom
window.addEventListener('touchstart', (e) => {
  if (e.touches.length > 1) {
    e.preventDefault();
  }
}, { passive: false });

// Prevent double-tap to zoom
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = (new Date()).getTime();
  if (now - lastTouchEnd <= DOUBLE_CLICK_THRESHOLD) {
    e.preventDefault();
  }

  lastTouchEnd = now;
}, false);


