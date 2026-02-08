import * as d3 from 'd3';
import './style.css';
import { getMatches, getLocalized, getSearchResultContent } from './search.js';

const LANGUAGE = "en-us";
// State
let currentDimensionY = "length";
let currentDimensionX = "none"; // "none", "length", "mass"
let selectedItem = null;
let lastMousePos = null;

const getUnit = (dim) => dim === "mass" ? "kg" : "m";
const getDimensionValueY = (d) => d.dimensions[currentDimensionY];
// Helper for X value: depends on mode
const getDimensionValueX = (d) => {
  if (currentDimensionX === "none") {
    // Fallback to x_coordinates for current Y dimension
    // If x_coordinates[currentDimensionY] is missing, default to 0
    return d.x_coordinates[currentDimensionY] !== undefined ? d.x_coordinates[currentDimensionY] : 0;
  } else {
    // Log plot mode
    return d.dimensions[currentDimensionX];
  }
};

const app = document.getElementById('app');
let width = app.clientWidth;
let height = app.clientHeight;

const svg = d3.select('#app')
  .append('svg')
  .attr('width', '100%')
  .attr('height', '100%')
  .attr('viewBox', [0, 0, width, height]);

// Define Gradients and Masks
const defs = svg.append("defs");

const paddingLeft = 80;
const fadeEnd = 160;
const fadeBottomHeight = 100;
const paddingBottom = 50;

const gradient = defs.append("linearGradient")
  .attr("id", "fade-gradient")
  .attr("gradientUnits", "userSpaceOnUse")
  .attr("x1", 0)
  .attr("x2", fadeEnd)
  .attr("y1", 0)
  .attr("y2", 0);

gradient.append("stop")
  .attr("offset", paddingLeft / fadeEnd)
  .attr("stop-color", "black");

gradient.append("stop")
  .attr("offset", "1")
  .attr("stop-color", "white");

const verticalGradient = defs.append("linearGradient")
  .attr("id", "fade-gradient-vertical")
  .attr("gradientUnits", "userSpaceOnUse")
  .attr("x1", 0)
  .attr("x2", 0)
  .attr("y1", height)
  .attr("y2", height - fadeBottomHeight);

verticalGradient.append("stop")
  .attr("offset", 0)
  .attr("stop-color", "black");

verticalGradient.append("stop")
  .attr("offset", paddingBottom / fadeBottomHeight)
  .attr("stop-color", "black");

verticalGradient.append("stop")
  .attr("offset", "1")
  .attr("stop-color", "white");

const maskLeft = defs.append("mask")
  .attr("id", "fade-mask-left");

const maskBottom = defs.append("mask")
  .attr("id", "fade-mask-bottom");

function updateMask() {
  maskLeft.selectAll("rect").remove();
  maskBottom.selectAll("rect").remove();

  // Left Mask: [0, paddingLeft] is black, [paddingLeft, fadeEnd] fades to white, [fadeEnd, width] is white
  maskLeft.append("rect")
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", fadeEnd)
    .attr("height", height)
    .attr("fill", "url(#fade-gradient)");

  maskLeft.append("rect")
    .attr("x", fadeEnd)
    .attr("y", 0)
    .attr("width", width - fadeEnd)
    .attr("height", height)
    .attr("fill", "white");

  // Bottom Mask: only active in 2D
  if (currentDimensionX !== "none") {
    svg.select("#fade-gradient-vertical")
      .attr("y1", height)
      .attr("y2", height - fadeBottomHeight);

    maskBottom.append("rect")
      .attr("x", 0)
      .attr("y", height - fadeBottomHeight)
      .attr("width", width)
      .attr("height", fadeBottomHeight)
      .attr("fill", "url(#fade-gradient-vertical)");

    maskBottom.append("rect")
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", width)
      .attr("height", height - fadeBottomHeight)
      .attr("fill", "white");
  } else {
    // Opaque
    maskBottom.append("rect")
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", width)
      .attr("height", height)
      .attr("fill", "white");
  }
}

updateMask();

const gridGroup = svg.append("g")
  .attr("class", "grid");

// Nested Groups for Multiplicative Masking
const dataLayerOuter = svg.append('g')
  .attr("class", "data-layer-outer")
  .attr("mask", "url(#fade-mask-left)");

const g = dataLayerOuter.append('g')
  .attr("class", "data-layer")
  .attr("mask", "url(#fade-mask-bottom)");

d3.json('/data.json').then(data => {
  // Data Processing
  data.forEach(d => {
    if (!d.dimensions) d.dimensions = {};
    for (const key in d.dimensions) d.dimensions[key] = +d.dimensions[key];

    if (!d.x_coordinates) d.x_coordinates = {};
    for (const key in d.x_coordinates) d.x_coordinates[key] = +d.x_coordinates[key];

    // Fallbacks
    if (d.x_coordinates.length === undefined) d.x_coordinates.length = 0;
    if (d.x_coordinates.mass === undefined) d.x_coordinates.mass = 0;
  });

  const categories = [
    "Atoms / Elements", "Astronomy", "Biology", "Density", "Electromagnetic", "Fundamental / Nuclear",
    "Geology", "Molecules", "Sound", "Technology", "Waves"
  ];
  const colors = [
    "#00FFFF", "#FFD700", "#7CFC00", "#FF8C00", "#1E90FF", "#FF00FF",
    "#CD853F", "#ff0000ff", "#FF69B4", "#C0C0C0", "#9370DB"
  ];
  const colorScale = d3.scaleOrdinal().domain(categories).range(colors);

  // Scales
  let yScale = d3.scaleLog().range([height - 50, 50]);
  let xScale = d3.scaleLinear(); // Default to linear, will switch to Log if needed

  // Zoom Setup
  const zoom = d3.zoom()
    .scaleExtent([1, 1000000])
    .on('zoom', (event) => {
      const t = event.transform;

      const domainY = yScale.domain();
      if (domainY[0] === domainY[1]) return;

      const minX = xScale.domain()[0];
      const maxX = xScale.domain()[1];

      const a = 0.5;
      const extX0 = xScale(minX) - (a * width) / t.k;
      const extX1 = xScale(maxX) + (a * width) / t.k;
      const extY0 = yScale(domainY[1]) - (a * height) / t.k;
      const extY1 = yScale(domainY[0]) + (a * height) / t.k;

      zoom.translateExtent([[extX0, extY0], [extX1, extY1]]);

      updateGrid(t);

      const newXScale = t.rescaleX(xScale);
      const newYScale = t.rescaleY(yScale);

      const currentDecadeHeight = Math.abs(newYScale(10) - newYScale(1));
      const currentFS = Math.min(12, currentDecadeHeight);
      const currentRadius = currentFS / 2.4;

      // Update positions using helpers
      g.selectAll('.item-group')
        .attr('transform', d => `translate(${newXScale(getDimensionValueX(d))}, ${newYScale(getDimensionValueY(d))})`);

      g.selectAll('.item-group circle')
        .attr('r', currentRadius);

      g.selectAll('.item-group text.label')
        .style('font-size', `${currentFS}px`);

      g.selectAll('.item-group rect.label-bg')
        .attr('x', 8)
        .attr('y', -currentFS * 0.7)
        .attr('height', currentFS * 1.5)
        .attr('width', d => {
          const textLen = getLocalized(d.displayName, LANGUAGE).length;
          const charWidth = currentFS * 0.6;
          return (textLen * charWidth + 6);
        });

      g.selectAll('.item-group rect.hit-area')
        .attr('x', -currentRadius - 5)
        .attr('y', -currentFS)
        .attr('height', currentFS * 2)
        .attr('width', d => {
          const textLen = getLocalized(d.displayName, LANGUAGE).length;
          return (currentRadius + 20 + textLen * currentFS * 0.6);
        });

      if (event.sourceEvent) {
        updateRuler(event.sourceEvent);
      } else if (lastMousePos) {
        updateRuler();
      }
    });

  svg.call(zoom);

  const updateGrid = (transform) => {
    const newYScale = transform.rescaleY(yScale);
    const newXScale = transform.rescaleX(xScale);
    const padding = 200;

    const yStart = newYScale.invert(height + padding);
    const yEnd = newYScale.invert(-padding);
    const paddedYScale = newYScale.copy().domain([
      d3.min([yStart, yEnd]),
      d3.max([yStart, yEnd])
    ]);
    const yTickValues = paddedYScale.ticks(15, "~e");

    // Horizontal Grid (Y-Axis)
    gridGroup.selectAll(".horizontal-grid").data([null]).join("g")
      .attr("class", "horizontal-grid")
      .call(d3.axisRight(newYScale)
        .tickValues(yTickValues)
        .tickSize(width)
        .tickFormat(d => {
          const log10 = Math.log10(d);
          if (Number.isInteger(log10)) {
            return `10^${log10} ${getUnit(currentDimensionY)}`;
          }
          return "";
        })
      );
    gridGroup.select(".horizontal-grid .domain").remove();

    // Vertical Grid (X-Axis)
    gridGroup.selectAll(".vertical-grid").data([null]).join("g")
      .attr("class", "vertical-grid");

    if (currentDimensionX === "none") {
      // Linear Grid logic (original)
      const decadeHeight = Math.abs(newYScale(10) - newYScale(1));
      const mainYTicks = yTickValues.filter(d => Math.abs(Math.log10(d) - Math.round(Math.log10(d))) < 1e-6);
      let stride = 1;
      if (mainYTicks.length >= 2) {
        stride = Math.abs(Math.round(Math.log10(mainYTicks[1])) - Math.round(Math.log10(mainYTicks[0])));
      }

      const xZero = newXScale.invert(0);
      const xDist = newXScale.invert(decadeHeight) - xZero;
      const spacing = Math.abs(xDist) * stride;

      const xTicks = [];
      const xMinPadded = newXScale.invert(-padding);
      const xMaxPadded = newXScale.invert(width + padding);

      if (spacing > 0 && isFinite(spacing)) {
        const start = Math.ceil(xMinPadded / spacing) * spacing;
        let current = start;
        const safetyLimit = 1000;
        let count = 0;
        while (current <= xMaxPadded && count < safetyLimit) {
          xTicks.push(current);
          current += spacing;
          count++;
        }
      }

      gridGroup.select(".vertical-grid")
        .call(d3.axisBottom(newXScale)
          .tickValues(xTicks)
          .tickFormat("")
          .tickSize(height)
        );

      // Styles for linear grid
      gridGroup.selectAll(".vertical-grid .tick line")
        .attr("stroke", "#00aaff")
        .attr("stroke-opacity", 0.4)
        .attr("stroke-dasharray", "2,2");
      gridGroup.selectAll(".vertical-grid .tick text").remove();

    } else {
      // Log Grid logic (similar to Y axis but vertical)
      const xStart = newXScale.invert(-padding);
      const xEnd = newXScale.invert(width + padding);
      const paddedXScale = newXScale.copy().domain([
        d3.min([xStart, xEnd]),
        d3.max([xStart, xEnd])
      ]);
      const xTickValues = paddedXScale.ticks(15, "~e");

      gridGroup.select(".vertical-grid")
        .call(d3.axisBottom(newXScale)
          .tickValues(xTickValues)
          .tickSize(height) // Extends downwards, which is what we want for full grid
          .tickFormat(d => {
            const log10 = Math.log10(d);
            if (Number.isInteger(log10)) {
              return `10^${log10} ${getUnit(currentDimensionX)}`;
            }
            return "";
          })
        );

      // Styles for Log Grid
      gridGroup.selectAll(".vertical-grid .tick line")
        .attr("stroke", "#00aaff")
        .attr("stroke-dasharray", "2,2")
        .attr("stroke-opacity", d => (d > 0 && Number.isInteger(Math.log10(d))) ? 0.4 : 0.25);

      // Position labels
      gridGroup.selectAll(".vertical-grid .tick text")
        .attr("y", height - 20) // Position at bottom
        .attr("dy", 0)
        .attr("fill", "#00aaff")
        .style("font-family", "monospace")
        .style("font-size", "12px")
        .attr("opacity", d => (d > 0 && Number.isInteger(Math.log10(d))) ? 1.0 : 0); // Hide minor labels too?
    }

    gridGroup.select(".vertical-grid .domain").remove();

    // Horizontal Grid Styles
    gridGroup.selectAll(".horizontal-grid .tick line")
      .attr("stroke", "#00aaff")
      .attr("stroke-dasharray", "2,2")
      .attr("stroke-opacity", d => (d > 0 && Number.isInteger(Math.log10(d))) ? 0.4 : 0.25);

    gridGroup.selectAll(".horizontal-grid .tick text")
      .attr("x", 10)
      .attr("dy", -4)
      .attr("fill", "#00aaff")
      .attr("opacity", d => (d > 0 && Number.isInteger(Math.log10(d))) ? 1.0 : 0) // Consistent label hiding?
      .style("font-family", "monospace")
      .style("font-size", "12px");
  };

  // Helper for highlighting
  function highlightItem(d) {
    g.selectAll('.item-group').classed("highlighted", false);
    g.selectAll('.item-group').filter(item => item.id === d.id).classed("highlighted", true).raise();
  }

  function unhighlightItems() {
    g.selectAll('.item-group').classed("highlighted", false);
  }

  // Unified update function
  const updatePlot = () => {
    // Filter data
    let filteredData = [];
    if (currentDimensionX === "none") {
      // Original behavior: Show items that have the Y dimension
      filteredData = data.filter(d => d.dimensions[currentDimensionY] !== undefined);
    } else {
      // 2D behavior: Show items that have BOTH dimensions
      filteredData = data.filter(d =>
        d.dimensions[currentDimensionY] !== undefined &&
        d.dimensions[currentDimensionX] !== undefined
      );
    }

    // Clear if no data
    if (filteredData.length === 0) {
      g.selectAll('.item-group').remove();
      updateLegend([]);
      return;
    }

    // Y Scale Update
    const minDimY = d3.min(filteredData, getDimensionValueY);
    const maxDimY = d3.max(filteredData, getDimensionValueY);
    yScale.domain([minDimY, maxDimY]);

    // X Scale Update
    if (currentDimensionX === "none") {
      xScale = d3.scaleLinear(); // Reset to linear
      const minX = d3.min(filteredData, getDimensionValueX);
      const maxX = d3.max(filteredData, getDimensionValueX);

      // Center logic for 1D
      const xCenter = (minX + maxX) / 2;
      const initialDecadeHeight = Math.abs(yScale(10) - yScale(1));
      const screenCenter = width / 2;
      xScale.domain([xCenter, xCenter + 1])
        .range([screenCenter, screenCenter + initialDecadeHeight]);
    } else {
      xScale = d3.scaleLog(); // Switch to Log
      const minDimX = d3.min(filteredData, getDimensionValueX);
      const maxDimX = d3.max(filteredData, getDimensionValueX);
      xScale.domain([minDimX, maxDimX]);

      // Map domain to range - maintain aspect ratio?
      // Let's just fit width for now
      xScale.range([fadeEnd, width - 50]); // Use fadeEnd to avoid opacity fade
    }

    // Data Join
    const items = g.selectAll('.item-group')
      .data(filteredData, d => d.id)
      .join(
        enter => {
          const grp = enter.append('g').attr('class', 'item-group');
          grp.append('rect').attr('class', 'hit-area')
            .attr('fill', 'transparent').style('cursor', 'pointer');
          grp.append('rect').attr('class', 'label-bg')
            .attr('rx', 4).attr('ry', 4).attr('fill', 'black').attr('opacity', 0);
          grp.append('circle').attr('cx', 0).attr('cy', 0)
            .attr('fill', d => colorScale(getLocalized(d.category, LANGUAGE)));
          grp.append('text').attr('class', 'label')
            .attr('x', 10).attr('y', 0).attr('dy', '.35em')
            .text(d => getLocalized(d.displayName, LANGUAGE))
            .attr('fill', d => colorScale(getLocalized(d.category, LANGUAGE)))
            .style('font-family', 'monospace');

          // Attach listeners
          grp.on("click", (event, d) => {
            showInfobox(d);
            event.stopPropagation();
          })
            .on("dblclick", (event, d) => {
              selectResult(d);
              event.stopPropagation();
            });
          return grp;
        },
        update => update,
        exit => exit.remove()
      );

    // Initial positioning via zoom reset
    if (selectedItem && filteredData.find(d => d.id === selectedItem.id)) {
      selectResult(selectedItem);
    } else {
      // If selection is no longer valid, hide infobox
      if (selectedItem) {
        hideInfobox();
      }

      // Default Zoom
      if (currentDimensionX === "none") {
        const initialTransform = d3.zoomIdentity.translate(-width * 0.05, 0);
        svg.transition().duration(750).call(zoom.transform, initialTransform);
      } else {
        // For 2D, maybe just fit?
        svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity);
      }
    }

    updateLegend(filteredData);
    updateMask();
  };

  d3.select('#dimension-select-y').on('change', function () {
    currentDimensionY = this.value;
    updatePlot();
  });

  d3.select('#dimension-select-x').on('change', function () {
    currentDimensionX = this.value; // "none" or dim
    updatePlot();
  });

  d3.select('#recenter-btn').on('click', () => {
    if (currentDimensionX === "none") {
      svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity.translate(-width * 0.05, 0));
    } else {
      svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity);
    }
  });

  // Legend
  const legendPadding = 15;
  const legendItemHeight = 20;

  const legend = svg.append("g").attr("class", "legend");

  // These need to be accessible for resize
  let legendWidth = 0;
  let legendHeight = 0;

  function updateLegend(currentData) {
    const activeCats = categories.filter(cat =>
      currentData.some(d => getLocalized(d.category, LANGUAGE) === cat)
    );

    legendHeight = activeCats.length * legendItemHeight + legendPadding * 2;

    // Data Join
    const texts = legend.selectAll("text")
      .data(activeCats, d => d);

    texts.exit().remove();

    const textEnter = texts.enter().append("text")
      .attr("x", legendPadding)
      .attr("dy", "0.35em")
      .style("font-family", "monospace")
      .style("font-size", "12px")
      .style("cursor", "pointer")
      .attr("fill", d => colorScale(d));

    const textMerge = textEnter.merge(texts)
      .attr("y", (d, i) => legendPadding + i * legendItemHeight + legendItemHeight / 2)
      .text(d => d);

    textEnter.on("mouseover", function (event, cat) {
      g.selectAll(".item-group")
        .transition().duration(200)
        .attr("opacity", d => getLocalized(d.category, LANGUAGE) === cat ? 1 : 0.2);
      g.selectAll(".item-group").filter(d => getLocalized(d.category, LANGUAGE) === cat).raise();
    })
      .on("mouseout", function () {
        g.selectAll(".item-group")
          .transition().duration(200)
          .attr("opacity", 1);
        g.selectAll(".item-group").sort((a, b) => d3.ascending(a.id, b.id));
      })
      .on("click", function (event, cat) {
        // Needs update for 2D filtering
        let categoryData = [];
        if (currentDimensionX === "none") {
          categoryData = data.filter(item => getLocalized(item.category, LANGUAGE) === cat && item.dimensions[currentDimensionY] !== undefined);
        } else {
          categoryData = data.filter(item => getLocalized(item.category, LANGUAGE) === cat && item.dimensions[currentDimensionY] !== undefined && item.dimensions[currentDimensionX] !== undefined);
        }

        if (categoryData.length === 0) return;

        const xValues = categoryData.map(d => xScale(getDimensionValueX(d)));
        const yValues = categoryData.map(d => yScale(getDimensionValueY(d)));

        const minX = d3.min(xValues);
        const maxX = d3.max(xValues);
        const minY = d3.min(yValues);
        const maxY = d3.max(yValues);

        const boundsWidth = maxX - minX;
        const boundsHeight = maxY - minY;
        const padLeft = 180; const padRight = 460; const padTop = 60; const padBottom = 60;
        const availWidth = width - padLeft - padRight;
        const availHeight = height - padTop - padBottom;

        let scaleX = boundsWidth > 0 ? availWidth / boundsWidth : 10000;
        let scaleY = boundsHeight > 0 ? availHeight / boundsHeight : 10000;
        let scale = Math.min(Math.max(Math.min(scaleX, scaleY), 1), 10000);

        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const screenCX = padLeft + availWidth / 2;
        const screenCY = padTop + availHeight / 2;

        const translate = [screenCX - cx * scale, screenCY - cy * scale];
        svg.transition().duration(750)
          .call(zoom.transform, d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale));
      });

    // Box
    let maxTextWidth = 0;
    textMerge.each(function () {
      const bbox = this.getComputedTextLength();
      if (bbox > maxTextWidth) maxTextWidth = bbox;
    });

    legendWidth = maxTextWidth + legendPadding * 2;

    // Update/Append Rect
    let rect = legend.select("rect");
    if (rect.empty()) {
      rect = legend.insert("rect", "text")
        .attr("fill", "black")
        .attr("stroke", "#00aaff")
        .attr("stroke-width", 1);
    }

    rect.attr("width", legendWidth).attr("height", legendHeight);

    // Position
    const legendX = width - legendWidth - 20;
    const legendY = height - legendHeight - 20;
    legend.attr("transform", `translate(${legendX}, ${legendY})`);
  }

  updatePlot();


  // Search Implementation
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');
  let selectedIndex = -1;

  function renderResults(matches, query) {
    searchResults.innerHTML = '';
    selectedIndex = -1;

    if (matches.length === 0) {
      searchResults.style.display = 'none';
      return;
    }

    matches.forEach((d, index) => {
      const div = document.createElement('div');
      div.className = 'search-result-item';

      div.innerHTML = getSearchResultContent(d, query, LANGUAGE);

      div.addEventListener('click', () => {
        selectResult(d);
      });

      div.addEventListener('mouseenter', () => {
        selectedIndex = index;
        updateSelection();
      });

      searchResults.appendChild(div);
    });

    searchResults.style.display = 'block';
  }

  function selectResult(result) {
    // Check if result is valid in current plot mode
    if (result.dimensions[currentDimensionY] === undefined) return;
    if (currentDimensionX !== "none" && result.dimensions[currentDimensionX] === undefined) return;

    searchInput.value = getLocalized(result.displayName, LANGUAGE);
    searchResults.style.display = 'none';

    highlightItem(result);
    showInfobox(result);

    const matchItem = data.find(d => d.id === result.id);
    if (!matchItem) return;

    const valY = getDimensionValueY(matchItem);
    const domainY = yScale.domain();
    const totalDecades = Math.log10(domainY[1]) - Math.log10(domainY[0]);
    const availableHeight = height - 100;

    let targetScale = (height * totalDecades) / (3 * availableHeight);

    // Dynamic Zoom Constraint based on neighbors
    // Filter matching current visibility rules
    let filteredData = [];
    if (currentDimensionX === "none") {
      filteredData = data.filter(d => d.dimensions[currentDimensionY] !== undefined);
    } else {
      filteredData = data.filter(d => d.dimensions[currentDimensionY] !== undefined && d.dimensions[currentDimensionX] !== undefined);
    }

    // Just use simplified neighbor check logic
    const neighbors = filteredData.filter(d => Math.abs(getDimensionValueY(d) - valY) < valY * 2);

    let minDiff = Infinity;
    const y1 = yScale(getDimensionValueY(matchItem));

    neighbors.forEach(p => {
      if (p.id === matchItem.id) return;
      const y2 = yScale(getDimensionValueY(p));
      const diff = Math.abs(y1 - y2);
      if (diff < minDiff) minDiff = diff;
    });

    if (minDiff !== Infinity) {
      const safeRadius = Math.min(width, height) / 2.2;
      const maxScaleForNeighbor = safeRadius / minDiff;
      targetScale = Math.min(targetScale, maxScaleForNeighbor);
    }

    targetScale = Math.max(1, Math.min(targetScale, 1000));

    const x = xScale(getDimensionValueX(matchItem));
    const y = yScale(getDimensionValueY(matchItem));

    const targetTransform = d3.zoomIdentity
      .translate(width / 2, height / 2)
      .scale(targetScale)
      .translate(-x, -y);

    svg.transition()
      .duration(750)
      .call(zoom.transform, targetTransform)
      .on("end", () => highlightItem(matchItem));
  }

  function updateSelection() {
    const items = searchResults.querySelectorAll('.search-result-item');
    items.forEach((item, index) => {
      if (index === selectedIndex) {
        item.classList.add('selected');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('selected');
      }
    });
  }

  searchInput.addEventListener('input', (e) => {
    const query = e.target.value;
    const matches = getMatches(data, query, LANGUAGE);

    // Filter matches
    let filtered = [];
    if (currentDimensionX === "none") {
      filtered = matches.filter(d => d.dimensions[currentDimensionY] !== undefined);
    } else {
      filtered = matches.filter(d => d.dimensions[currentDimensionY] !== undefined && d.dimensions[currentDimensionX] !== undefined);
    }

    renderResults(filtered, query);
  });

  searchInput.addEventListener('focus', () => {
    const query = searchInput.value;
    if (query) {
      const matches = getMatches(data, query, LANGUAGE);
      let filtered = [];
      if (currentDimensionX === "none") {
        filtered = matches.filter(d => d.dimensions[currentDimensionY] !== undefined);
      } else {
        filtered = matches.filter(d => d.dimensions[currentDimensionY] !== undefined && d.dimensions[currentDimensionX] !== undefined);
      }
      renderResults(filtered, query);
    }
    searchResults.scrollTop = 0;
  });

  searchInput.addEventListener('keydown', (e) => {
    const items = searchResults.querySelectorAll('.search-result-item');
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
      selectedIndex = (selectedIndex + 1) % items.length;
      updateSelection();
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      selectedIndex = (selectedIndex - 1 + items.length) % items.length;
      updateSelection();
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (selectedIndex >= 0) {
        const query = searchInput.value;
        const matches = getMatches(data, query, LANGUAGE);
        let filtered = [];
        if (currentDimensionX === "none") {
          filtered = matches.filter(d => d.dimensions[currentDimensionY] !== undefined);
        } else {
          filtered = matches.filter(d => d.dimensions[currentDimensionY] !== undefined && d.dimensions[currentDimensionX] !== undefined);
        }
        if (filtered[selectedIndex]) {
          selectResult(filtered[selectedIndex]);
        }
      } else if (items.length > 0) {
        const query = searchInput.value;
        const matches = getMatches(data, query, LANGUAGE);
        let filtered = [];
        if (currentDimensionX === "none") {
          filtered = matches.filter(d => d.dimensions[currentDimensionY] !== undefined);
        } else {
          filtered = matches.filter(d => d.dimensions[currentDimensionY] !== undefined && d.dimensions[currentDimensionX] !== undefined);
        }
        if (filtered[0]) {
          selectResult(filtered[0]);
        }
      }
      e.preventDefault();
    } else if (e.key === 'Escape') {
      searchResults.style.display = 'none';
    }
  });

  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
      searchResults.style.display = 'none';
    }
  });

  document.addEventListener('keydown', (e) => {
    if (document.activeElement === searchInput) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      searchInput.value = '';
      renderResults([], '');
      searchInput.focus();
      return;
    }
    if (e.key.length === 1) {
      searchInput.focus();
    }
  });


  // Infobox Implementation
  const infobox = d3.select("body").append("div")
    .attr("class", "infobox")
    .style("display", "none");

  function showInfobox(d) {
    selectedItem = d;
    highlightItem(d);

    const localizedDisplayName = getLocalized(d.displayName, LANGUAGE);
    const localizedCategory = getLocalized(d.category, LANGUAGE);
    let tagsContent = "";
    if (d.tags && d.tags[LANGUAGE]) {
      tagsContent = `<div class="infobox-row"><span class="infobox-label">Tags:</span>${d.tags[LANGUAGE].join(", ")}</div>`;
    }

    // Build dimensions content
    let dimsContent = "";

    const formatWithSigFigs = (num) => {
      let n = num;
      if (n === 0) return "0";
      if (Number.isInteger(n) && !n.toString().includes('e')) {
        const s = Math.abs(n).toString();
        const trimmed = s.replace(/0+$/, '');
        const sigFigs = trimmed.length;
        return n.toExponential(Math.max(0, sigFigs - 1));
      }
      return n.toExponential(2);
    };

    const addDimRow = (dim) => {
      const val = d.dimensions[dim];
      if (val !== undefined) {
        const unit = getUnit(dim);
        const label = dim.charAt(0).toUpperCase() + dim.slice(1);
        const exp = formatWithSigFigs(val);
        const [mantissa, exponent] = exp.split('e');
        const expVal = parseInt(exponent, 10);
        const txt = `${mantissa} × 10^${expVal} ${unit}`;
        return `<div class="infobox-row"><span class="infobox-label">${label}:</span>${txt}</div>`;
      }
      return "";
    };

    // Always show Y dimension
    dimsContent += addDimRow(currentDimensionY);
    // Show X dimension if selected
    if (currentDimensionX !== "none") {
      dimsContent += addDimRow(currentDimensionX);
    }


    const categoryColor = colorScale(localizedCategory);

    infobox.html(`
      <div class="infobox-title">${localizedDisplayName}</div>
      ${dimsContent}
      <div class="infobox-row"><span class="infobox-label">Category:</span><span style="color: ${categoryColor}">${localizedCategory}</span></div>
      ${tagsContent}
    `)
      .style("display", "block");
  }

  function hideInfobox() {
    infobox.style("display", "none");
    unhighlightItems();
    selectedItem = null;
  }

  // Hide on background click
  svg.on("click", () => {
    hideInfobox();
  });


  // Cursor Ruler
  const rulerGroup = svg.append("g")
    .attr("class", "cursor-ruler")
    .style("pointer-events", "none")
    .style("display", "none");

  // Vertical line (tracks X position)
  const rulerLineX = rulerGroup.append("line")
    .attr("x1", 0).attr("x2", width).attr("stroke", "red").attr("stroke-width", 1).attr("stroke-dasharray", "4,2");

  // Horizontal line (tracks Y position) -> only need if we want crosshair.
  // Original only had horizontal line (tracking Y).
  // "2D Crosshair" means horizontal AND vertical lines.

  const rulerLineY = rulerGroup.append("line") // This will be the vertical line tracking X
    .attr("y1", 0).attr("y2", height).attr("stroke", "red").attr("stroke-width", 1).attr("stroke-dasharray", "4,2");

  const rulerLabelBackground = rulerGroup.append("rect")
    .attr("fill", "black").attr("rx", 4).attr("ry", 4).attr("opacity", 0.7);

  const rulerLabel = rulerGroup.append("text")
    .attr("fill", "white").style("font-family", "monospace").style("font-size", "12px").attr("dy", "0.35em").attr("text-anchor", "start");

  function updateRuler(event) {
    if (event) {
      lastMousePos = d3.pointer(event, svg.node());
    }
    if (!lastMousePos) return;

    rulerGroup.style("display", null);
    const t = d3.zoomTransform(svg.node());
    const [mouseX, mouseY] = lastMousePos;

    // Update Lines
    rulerLineX.attr("y1", mouseY).attr("y2", mouseY); // Horizontal line at Mouse Y

    if (currentDimensionX !== "none") {
      rulerLineY.style("display", null);
      rulerLineY.attr("x1", mouseX).attr("x2", mouseX); // Vertical line at Mouse X
    } else {
      rulerLineY.style("display", "none");
    }

    const newYScale = t.rescaleY(yScale);
    const valY = newYScale.invert(mouseY);

    // Format Y
    const formatVal = (v, unit) => {
      const exp = v.toExponential(2);
      const [mantissa, exponent] = exp.split('e');
      const expVal = parseInt(exponent, 10);
      return `${mantissa} × 10^${expVal} ${unit}`;
    };

    let labelText = "";
    if (currentDimensionX !== "none") {
      const newXScale = t.rescaleX(xScale);
      const valX = newXScale.invert(mouseX);
      const txtY = formatVal(valY, getUnit(currentDimensionY));
      const txtX = formatVal(valX, getUnit(currentDimensionX));
      labelText = `Y: ${txtY}, X: ${txtX}`;
    } else {
      labelText = formatVal(valY, getUnit(currentDimensionY));
    }

    rulerLabel.attr("x", mouseX + 15).attr("y", mouseY - 15).text(labelText);

    const bbox = rulerLabel.node().getBBox();
    rulerLabelBackground.attr("x", bbox.x - 4).attr("y", bbox.y - 4).attr("width", bbox.width + 8).attr("height", bbox.height + 8);
  }

  svg.on("mousemove", (event) => {
    updateRuler(event);
  });

  svg.on("mouseleave", () => {
    rulerGroup.style("display", "none");
  });


  // Resize Handler
  window.addEventListener('resize', () => {
    width = app.clientWidth;
    height = app.clientHeight;
    svg.attr('viewBox', [0, 0, width, height]);

    // Update ranges
    yScale.range([height - 50, 50]);
    if (currentDimensionX === "none") {
      const initialDecadeHeight = Math.abs(yScale(10) - yScale(1));
      const screenCenter = width / 2;
      const xCenter = (xScale.domain()[0] + xScale.domain()[1]) / 2;
      xScale.range([screenCenter, screenCenter + initialDecadeHeight]);
    } else {
      xScale.range([fadeEnd, width - 50]);
    }

    updateMask();

    // Update legend pos
    const legendX = width - legendWidth - 20;
    const legendY = height - legendHeight - 20;
    legend.attr("transform", `translate(${legendX}, ${legendY})`);

    // Refresh zoom
    const t = d3.zoomTransform(svg.node());
    svg.call(zoom.transform, t);
  });

});
