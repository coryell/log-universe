import * as d3 from 'd3';
import './style.css';
import { getMatches, getLocalized, getSearchResultContent } from './search.js';

const LANGUAGE = "en-us";
// State
let currentDimensionY = "length";
let currentDimensionX = "none"; // "none", "length", "mass", "duration"
let prevDimensionY = "length";
let prevDimensionX = "none";
let selectedItem = null;
let lastMousePos = null;
let paddingRight = 50;
let isInitialLoad = true;

const getUnit = (dim) => {
  if (dim === "mass") return "kg";
  if (dim === "duration") return "s";
  return "m";
};
const getDimensionValueY = (d) => Number(d.dimensions[currentDimensionY]);
// Helper for X value: depends on mode
const getDimensionValueX = (d) => {
  if (currentDimensionX === "none") {
    return d.x_coordinates[currentDimensionY];
  } else {
    // Log plot mode
    return Number(d.dimensions[currentDimensionX]);
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

// Separate label groups with appropriate masks:
// - X-axis labels (at bottom) fade near the LEFT edge where Y-labels are
// - Y-axis labels (at left) fade near the BOTTOM edge where X-labels are
const xLabelGroup = svg.append("g")
  .attr("class", "x-axis-labels")
  .attr("mask", "url(#fade-mask-left)");

const yLabelGroup = svg.append("g")
  .attr("class", "y-axis-labels")
  .attr("mask", "url(#fade-mask-bottom)");

// Nested Groups for Multiplicative Masking
const dataLayerOuter = svg.append('g')
  .attr("class", "data-layer-outer")
  .attr("mask", "url(#fade-mask-left)");

const g = dataLayerOuter.append('g')
  .attr("class", "data-layer")
  .attr("mask", "url(#fade-mask-bottom)");

const gCombined = dataLayerOuter.append('g')
  .attr("class", "combined-layer")
  .attr("mask", "url(#fade-mask-bottom)");

d3.json('/data.json').then(data => {
  // Data Processing
  data.forEach(d => {
    if (!d.dimensions) d.dimensions = {};
    // Store original strings for exact comparison
    d._orig_dimensions = { ...d.dimensions };

    if (!d.x_coordinates) d.x_coordinates = {};
    d._orig_x_coordinates = { ...d.x_coordinates };

    // Numerical coersion for calculations
    for (const key in d.x_coordinates) d.x_coordinates[key] = +d.x_coordinates[key];

    // Fallbacks
    // if (d.x_coordinates.length === undefined) d.x_coordinates.length = 0;
    // if (d.x_coordinates.mass === undefined) d.x_coordinates.mass = 0;
  });

  const categories = [
    "Atoms / Elements", "Astronomy", "Biology", "Electromagnetic", "Fundamental / Nuclear",
    "Geology", "Molecules", "Spacing", "Sound", "Technology", "Waves"
  ];
  const colors = [
    "#00FFFF", "#FFD700", "#7CFC00", "#1E90FF", "#FF00FF",
    "#CD853F", "#ff0000ff", "#FF8C00", "#FF69B4", "#C0C0C0", "#9370DB"
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

      const a = 0.5; // Padding factor
      const domainX = xScale.domain();
      const extX0 = xScale(domainX[0]) - (a * width) / t.k;
      const extX1 = xScale(domainX[1]) + (a * width) / t.k;

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
      const allItemGroups = d3.selectAll('.dataLayerOuter .item-group'); // This is too broad maybe? 
      // Better: select specifically
      g.selectAll('.item-group')
        .attr('transform', d => `translate(${newXScale(getDimensionValueX(d))}, ${newYScale(getDimensionValueY(d))})`);
      gCombined.selectAll('.item-group')
        .attr('transform', d => {
          // Combined data contains _members[0] which we can use for position
          const first = d._members[0];
          return `translate(${newXScale(getDimensionValueX(first))}, ${newYScale(getDimensionValueY(first))})`;
        });

      // Update circles and labels for both individual and combined
      const allGroups = dataLayerOuter.selectAll('.item-group');

      allGroups.selectAll('circle')
        .attr('r', currentRadius);

      allGroups.selectAll('text.label')
        .style('font-size', `${currentFS}px`);

      allGroups.selectAll('rect.label-bg')
        .attr('x', 8)
        .attr('y', -currentFS * 0.7)
        .attr('height', currentFS * 1.5)
        .attr('width', d => {
          const textLen = getLocalized(d.displayName, LANGUAGE).length;
          const charWidth = currentFS * 0.6;
          return (textLen * charWidth + 6);
        });

      allGroups.selectAll('rect.hit-area')
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

  // Recenter on zoom out at limit
  let lastRecenterTime = 0;
  // Use capture phase to ensure we see the event before D3's zoom handler might swallow it
  svg.node().addEventListener('wheel', (event) => {
    const t = d3.zoomTransform(svg.node());
    // On trackpads, pinch-out often results in deltaY > 0 with ctrlKey: true
    // Standard scroll-to-zoom also uses deltaY > 0
    if (t.k <= 1.05 && event.deltaY > 0) {
      const now = Date.now();
      if (now - lastRecenterTime > 1500) {
        lastRecenterTime = now;
        if (currentDimensionX === "none") {
          svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity.translate(-width * 0.05, 0));
        } else {
          svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity);
        }
      }
    }
  }, { capture: true, passive: true });

  const updateGrid = (transform) => {
    const newYScale = transform.rescaleY(yScale);
    const newXScale = transform.rescaleX(xScale);
    const padding = 200;

    // Clear all labels at the start (they will be re-created below)
    xLabelGroup.selectAll(".x-label").remove();
    yLabelGroup.selectAll(".y-label").remove();

    // --- Y Axis Grid Calculation ---
    const yStart = newYScale.invert(height + padding);
    const yEnd = newYScale.invert(-padding);
    const paddedYScale = newYScale.copy().domain([
      d3.min([yStart, yEnd]),
      d3.max([yStart, yEnd])
    ]);
    let yTickValues = paddedYScale.ticks(15, "~e");
    const hasSubTenY = yTickValues.some(d => !Number.isInteger(Math.log10(d)));
    const majorYDecades = new Set();
    yTickValues.forEach(d => {
      if (Number.isInteger(Math.log10(d))) majorYDecades.add(d);
    });

    if (!hasSubTenY) {
      // Add intermediate decades if not already there
      const logMin = Math.ceil(Math.log10(d3.min([yStart, yEnd])));
      const logMax = Math.floor(Math.log10(d3.max([yStart, yEnd])));
      const allYDecades = [];
      for (let i = logMin; i <= logMax; i++) {
        allYDecades.push(Math.pow(10, i));
      }
      yTickValues = Array.from(new Set([...yTickValues, ...allYDecades])).sort((a, b) => a - b);
    }

    // Horizontal Grid (Y-Axis)
    gridGroup.selectAll(".horizontal-grid").data([null]).join("g")
      .attr("class", "horizontal-grid")
      .call(d3.axisRight(newYScale)
        .tickValues(yTickValues)
        .tickSize(width)
        .tickFormat(d => {
          const log10 = Math.log10(d);
          if (majorYDecades.has(d)) {
            return `10^${log10} ${getUnit(currentDimensionY)}`;
          }
          return "";
        })
      );
    gridGroup.select(".horizontal-grid .domain").remove();

    // --- X Axis Grid Calculation ---
    gridGroup.selectAll(".vertical-grid").data([null]).join("g")
      .attr("class", "vertical-grid");

    if (currentDimensionX === "none") {
      // Linear Grid logic (original)
      const decadeHeight = Math.abs(newYScale(10) - newYScale(1));
      const mainYTicks = yTickValues.filter(d => majorYDecades.has(d));
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
      let xTickValues = paddedXScale.ticks(15, "~e");
      const hasSubTenX = xTickValues.some(d => !Number.isInteger(Math.log10(d)));
      const majorXDecades = new Set();
      xTickValues.forEach(d => {
        if (Number.isInteger(Math.log10(d))) majorXDecades.add(d);
      });

      if (!hasSubTenX) {
        const logMin = Math.ceil(Math.log10(d3.min([xStart, xEnd])));
        const logMax = Math.floor(Math.log10(d3.max([xStart, xEnd])));
        const allXDecades = [];
        for (let i = logMin; i <= logMax; i++) {
          allXDecades.push(Math.pow(10, i));
        }
        xTickValues = Array.from(new Set([...xTickValues, ...allXDecades])).sort((a, b) => a - b);
      }

      gridGroup.select(".vertical-grid")
        .call(d3.axisBottom(newXScale)
          .tickValues(xTickValues)
          .tickSize(height)
          .tickFormat(d => {
            const log10 = Math.log10(d);
            if (majorXDecades.has(d)) {
              return `10^${log10} ${getUnit(currentDimensionX)}`;
            }
            return "";
          })
        );

      // Styles for Log Grid
      gridGroup.selectAll(".vertical-grid .tick line")
        .attr("stroke", "#00aaff")
        .attr("stroke-dasharray", "2,2")
        .attr("stroke-opacity", d => (majorXDecades.has(d)) ? 0.4 : 0.25);

      // Move X-axis labels to the masked labelGroup
      gridGroup.selectAll(".vertical-grid .tick text").each(function (d) {
        const xPos = newXScale(d);
        const log10 = Math.log10(d);
        if (majorXDecades.has(d)) {
          xLabelGroup.append("text")
            .attr("class", "x-label")
            .attr("x", xPos)
            .attr("y", height - 20)
            .attr("text-anchor", "middle")
            .attr("fill", "#00aaff")
            .style("font-family", "monospace")
            .style("font-size", "12px")
            .text(`10^${log10} ${getUnit(currentDimensionX)}`);
        }
      });
      // Hide the original texts
      gridGroup.selectAll(".vertical-grid .tick text").attr("opacity", 0);
    }

    gridGroup.select(".vertical-grid .domain").remove();

    // Horizontal Grid Styles
    gridGroup.selectAll(".horizontal-grid .tick line")
      .attr("stroke", "#00aaff")
      .attr("stroke-dasharray", "2,2")
      .attr("stroke-opacity", d => (majorYDecades.has(d)) ? 0.4 : 0.25);

    // Move Y-axis labels to the masked labelGroup (only in 2D mode)
    if (currentDimensionX !== "none") {
      gridGroup.selectAll(".horizontal-grid .tick text").each(function (d) {
        const yPos = newYScale(d);
        const log10 = Math.log10(d);
        if (majorYDecades.has(d)) {
          yLabelGroup.append("text")
            .attr("class", "y-label")
            .attr("x", 10)
            .attr("y", yPos - 4)
            .attr("fill", "#00aaff")
            .style("font-family", "monospace")
            .style("font-size", "12px")
            .text(`10^${log10} ${getUnit(currentDimensionY)}`);
        }
      });
      // Hide original texts
      gridGroup.selectAll(".horizontal-grid .tick text").attr("opacity", 0);
    } else {
      // In 1D mode, keep labels in gridGroup
      gridGroup.selectAll(".horizontal-grid .tick text")
        .attr("x", 10)
        .attr("dy", -4)
        .attr("fill", "#00aaff")
        .attr("opacity", d => majorYDecades.has(d) ? 1.0 : 0)
        .style("font-family", "monospace")
        .style("font-size", "12px");
    }
  };

  // Helper for highlighting
  function highlightItem(d) {
    g.selectAll('.item-group').classed("highlighted", false);
    gCombined.selectAll('.item-group').classed("highlighted", false);

    // If d is itself a combined item, highlight it directly
    if (d._isCombined) {
      gCombined.selectAll('.item-group').filter(cd => cd.id === d.id).classed("highlighted", true).raise();
      return;
    }

    // Check if it's in a combined point
    let combined = null;
    gCombined.selectAll('.item-group').each(function (cd) {
      if (cd._members && cd._members.some(m => m.id === d.id)) {
        combined = this;
      }
    });

    if (combined) {
      d3.select(combined).classed("highlighted", true).raise();
    } else {
      g.selectAll('.item-group').filter(item => item.id === d.id).classed("highlighted", true).raise();
    }
  }

  function unhighlightItems() {
    g.selectAll('.item-group').classed("highlighted", false);
    gCombined.selectAll('.item-group').classed("highlighted", false);
  }

  const getFilteredData = (dataList) => {
    if (currentDimensionX === "none") {
      // Show items that have the Y dimension AND valid x_coordinates for that dimension
      return dataList.filter(d => d.dimensions[currentDimensionY] !== undefined && d.x_coordinates[currentDimensionY] !== undefined);
    } else {
      // 2D behavior: Show items that have BOTH dimensions
      return dataList.filter(d =>
        d.dimensions[currentDimensionY] !== undefined &&
        d.dimensions[currentDimensionX] !== undefined
      );
    }
  };

  // Unified update function
  const updatePlot = () => {
    // Capture previous positions if dimensions are changing
    const dimChanged = (currentDimensionX !== prevDimensionX) || (currentDimensionY !== prevDimensionY);
    const prevPositions = new Map();

    if (dimChanged && !isInitialLoad) {
      gCombined.selectAll(".item-group").remove();
      g.selectAll('.item-group')
        .style("opacity", 1)
        .style("pointer-events", "auto");

      g.selectAll('.item-group').each(function (d) {
        const tr = d3.select(this).attr('transform');
        if (tr) prevPositions.set(d.id, tr);
      });
    }

    // Filter data
    const filteredData = getFilteredData(data);

    // Clear if no data
    if (filteredData.length === 0) {
      g.selectAll('.item-group').remove();
      updateLegend([]);
      return;
    }

    // Y Scale Update
    let minDimY = d3.min(filteredData, getDimensionValueY);
    let maxDimY = d3.max(filteredData, getDimensionValueY);

    if (minDimY === maxDimY) {
      if (minDimY <= 0) {
        // Log scale cannot handle <= 0, should fallback or error, but let's just nudge
        minDimY = 0.1;
        maxDimY = 10;
      } else {
        // Create a decade range around the single point
        minDimY = minDimY / 10;
        maxDimY = maxDimY * 10;
      }
    }
    yScale.domain([minDimY, maxDimY]);

    if (currentDimensionX !== "none") {
      yScale.range([height - fadeBottomHeight, 50]);
    } else {
      yScale.range([height - 50, 50]);
    }

    // X Scale Update
    if (currentDimensionX === "none") {
      xScale = d3.scaleLinear(); // Reset to linear
      const minX = d3.min(filteredData, getDimensionValueX);
      const maxX = d3.max(filteredData, getDimensionValueX);

      // Center logic for 1D - use full domain for pan constraints
      const initialDecadeHeight = Math.abs(yScale(10) - yScale(1));
      const screenCenter = width / 2;

      if (minX === maxX) {
        // Degenerate case (e.g. Mass view where all X are 0)
        // Set scale to 1 unit = 1 decade height
        xScale.domain([minX, minX + 1])
          .range([screenCenter, screenCenter + initialDecadeHeight]);
      } else {
        const xCenter = (minX + maxX) / 2;

        const pixelMin = screenCenter + (minX - xCenter) * initialDecadeHeight;
        const pixelMax = screenCenter + (maxX - xCenter) * initialDecadeHeight;

        xScale.domain([minX, maxX])
          .range([pixelMin, pixelMax]);
      }
    } else {
      xScale = d3.scaleLog(); // Switch to Log
      const minDimX = d3.min(filteredData, getDimensionValueX);
      const maxDimX = d3.max(filteredData, getDimensionValueX);
      xScale.domain([minDimX, maxDimX]);

      // Dynamic padding based on label length
      const maxCharCount = d3.max(filteredData, d => getLocalized(d.displayName, LANGUAGE).length);
      paddingRight = Math.max(100, maxCharCount * 12 * 0.6 + 40);

      // Force 1:1 Aspect Ratio
      const xDecades = Math.log10(maxDimX) - Math.log10(minDimX);
      const yDecades = Math.log10(maxDimY) - Math.log10(minDimY);

      // Available screen space
      // X: [fadeEnd, width - paddingRight]
      const availW = width - paddingRight - fadeEnd;
      // Y: [height - fadeBottomHeight, 50] (Note: Y creates bottom-up coordinates)
      // Height available is (height - fadeBottomHeight) - 50
      const availH = (height - fadeBottomHeight) - 50;

      // Pixels per decade
      // We want the same pixels/decade for both.
      // So we fit the larger dimension into the available space.
      const ppdX = availW / xDecades;
      const ppdY = availH / yDecades;
      const ppd = Math.min(ppdX, ppdY);

      const newWidth = xDecades * ppd;
      const newHeight = yDecades * ppd;

      // Center it
      const xOffset = (availW - newWidth) / 2;
      const yOffset = (availH - newHeight) / 2;

      // Ranges
      // X: Starts at fadeEnd + xOffset
      xScale.range([fadeEnd + xOffset, fadeEnd + xOffset + newWidth]);

      // Y: Top is 50 + yOffset. Bottom is Top + newHeight.
      // But D3 Y scale is usually [bottom, top] for [min, max] value?
      // Wait, standard D3 Y axis: range [height, 0] maps to domain [min, max].
      // Here, range [bottomPixel, topPixel].
      // We want minDimY (bottom) to be at bottomPixel.
      // We want maxDimY (top) to be at topPixel.
      // topPixel = 50 + yOffset
      // bottomPixel = topPixel + newHeight
      // So range is [bottomPixel, topPixel]
      const topPixel = 50 + yOffset;
      const bottomPixel = topPixel + newHeight;
      yScale.range([bottomPixel, topPixel]);
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
    // dimChanged calculated at start

    if (selectedItem && filteredData.find(d => d.id === selectedItem.id)) {
      selectResult(selectedItem);
    } else {
      if (selectedItem) {
        hideInfobox();
      }
      // Default Zoom
      if (currentDimensionX === "none") {
        const initialTransform = d3.zoomIdentity.translate(-width * 0.05, 0);
        if (isInitialLoad || dimChanged) {
          svg.call(zoom.transform, initialTransform);
        } else {
          svg.transition().duration(750).call(zoom.transform, initialTransform);
        }
      } else {
        // For 2D, maybe just fit?
        if (isInitialLoad || dimChanged) {
          svg.call(zoom.transform, d3.zoomIdentity);
        } else {
          svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity);
        }
      }
    }

    // Animate points if dimensions changed
    if (dimChanged && prevPositions.size > 0) {
      items.each(function (d) {
        const prevTransform = prevPositions.get(d.id);
        if (prevTransform) {
          const currentTransform = d3.select(this).attr('transform');
          if (currentTransform && currentTransform !== prevTransform) {
            d3.select(this)
              .attr('transform', prevTransform)
              .transition()
              .duration(1000)
              .ease(d3.easeCubicOut)
              .attr('transform', currentTransform);
          }
        }
      });
    }

    updateLegend(filteredData);
    updateMask();

    if (dimChanged) {
      d3.timeout(applyGrouping, 1100);
    } else {
      applyGrouping();
    }

    isInitialLoad = false;
    prevDimensionX = currentDimensionX;
    prevDimensionY = currentDimensionY;
  };

  // Initialize Dropdowns
  d3.select('#dimension-select-y').property('value', currentDimensionY);
  d3.select('#dimension-select-x').property('value', currentDimensionX);

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
        .attr("stroke-width", 1)
        .attr("rx", 5)
        .attr("ry", 5);
    }

    rect.attr("width", legendWidth).attr("height", legendHeight);

    // Position
    const legendX = width - legendWidth - 20;
    const legendY = height - legendHeight - 60;
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
    const filtered = getFilteredData(matches);

    renderResults(filtered, query);
  });

  searchInput.addEventListener('focus', () => {
    const query = searchInput.value;
    if (query) {
      const matches = getMatches(data, query, LANGUAGE);
      const filtered = getFilteredData(matches);
      renderResults(filtered, query);
    }
    searchResults.scrollTop = 0;
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      searchResults.style.display = 'none';
      searchInput.blur();
      hideInfobox();
      return;
    }

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
        const filtered = getFilteredData(matches);
        if (filtered[selectedIndex]) {
          selectResult(filtered[selectedIndex]);
        }
      } else if (items.length > 0) {
        const query = searchInput.value;
        const matches = getMatches(data, query, LANGUAGE);
        const filtered = getFilteredData(matches);
        if (filtered[0]) {
          selectResult(filtered[0]);
        }
      }
      e.preventDefault();
    }
  });

  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
      searchResults.style.display = 'none';
    }
  });

  document.addEventListener('keydown', (e) => {
    if (document.activeElement === searchInput) return;
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'f') {
        e.preventDefault();
        searchInput.focus();
        return;
      }
    }
    if (e.altKey) return;
    if (e.key === 'Escape') {
      hideInfobox();
      return;
    }
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

    const members = d._isCombined ? d._members : [d];
    let fullContent = "";

    members.forEach((member, index) => {
      const localizedDisplayName = getLocalized(member.displayName, LANGUAGE);
      const localizedCategory = getLocalized(member.category, LANGUAGE);
      let tagsContent = "";
      if (member.tags && member.tags[LANGUAGE]) {
        tagsContent = `<div class="infobox-row"><span class="infobox-label">Tags:</span>${member.tags[LANGUAGE].join(", ")}</div>`;
      }

      // Build dimensions content
      let dimsContent = "";

      const formatDimension = (val) => {
        if (val === undefined || val === null) return "";
        const s = val.toString().toLowerCase();
        if (s.includes('e')) {
          const parts = s.split('e');
          const coeff = parts[0];
          const exp = parseInt(parts[1], 10);
          return `${coeff} × 10^${exp}`;
        }
        return s;
      };

      const addDimRow = (dim) => {
        const val = member.dimensions[dim];
        if (val !== undefined) {
          const unit = getUnit(dim);
          const label = dim.charAt(0).toUpperCase() + dim.slice(1);
          const formattedVal = formatDimension(val);
          const txt = `${formattedVal} ${unit}`;

          let sourceLink = "";
          if (member.sources && member.sources[dim]) {
            sourceLink = `<button class="copy-btn" onclick="window.open('${member.sources[dim]}', '_blank')">Source</button>`;
          }

          return `<div class="infobox-row"><span class="infobox-label">${label}:</span>${txt}<button class="copy-btn" data-copy-text="${txt}">Copy</button>${sourceLink}</div>`;
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

      const entrySeparator = (index > 0) ? '<div class="infobox-divider"></div>' : '';

      fullContent += `
        ${entrySeparator}
        <div class="infobox-entry" data-id="${member.id}">
          <div class="infobox-title">${localizedDisplayName}</div>
          ${dimsContent}
          <div class="infobox-row"><span class="infobox-label">Category:</span><span style="color: ${categoryColor}">${localizedCategory}</span></div>
          ${tagsContent}
        </div>
      `;
    });

    infobox.html(fullContent).style("display", "block");

    // Attach copy event listeners
    infobox.selectAll(".copy-btn").on("click", function (event) {
      event.stopPropagation();
      const textToCopy = d3.select(this).attr("data-copy-text");
      if (!textToCopy) return; // Skip Source buttons
      navigator.clipboard.writeText(textToCopy).then(() => {
        const btn = d3.select(this);
        const originalText = btn.text();
        btn.text("Copied!");
        setTimeout(() => {
          btn.text(originalText);
        }, 2000);
      }).catch(err => {
        console.error('Failed to copy text: ', err);
      });
    });
  }

  function hideInfobox() {
    infobox.style("display", "none");
    unhighlightItems();
    selectedItem = null;
  }

  // Hide on background click
  function applyGrouping() {
    gCombined.selectAll(".item-group").remove();

    // Grouping
    const groups = new Map();
    const filteredData = getFilteredData(data);

    filteredData.forEach(d => {
      let key = "";
      if (currentDimensionX === "none") {
        key = `y:${d._orig_dimensions[currentDimensionY]}|x:${d._orig_x_coordinates[currentDimensionY]}`;
      } else {
        key = `y:${d._orig_dimensions[currentDimensionY]}|x:${d._orig_dimensions[currentDimensionX]}`;
      }

      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(d);
    });

    groups.forEach((members, key) => {
      if (members.length > 1) {
        // Hide individual points
        members.forEach(m => {
          g.selectAll(".item-group").filter(d => d.id === m.id)
            .style("opacity", 0)
            .style("pointer-events", "none");
        });

        // Create combined point
        const first = members[0];
        const combinedDisplayName = members.map(m => getLocalized(m.displayName, LANGUAGE)).join(" / ");
        const combinedCategory = first.category; // Just use first for color

        // Clone/Mock a member for the SVG join
        const combinedData = {
          ...first,
          id: `combined-${key}`,
          displayName: { [LANGUAGE]: combinedDisplayName },
          _isCombined: true,
          _members: members
        };

        const t = d3.zoomTransform(svg.node());
        const newXScale = t.rescaleX(xScale);
        const newYScale = t.rescaleY(yScale);

        const currentDecadeHeight = Math.abs(newYScale(10) - newYScale(1));
        const currentFS = Math.min(12, currentDecadeHeight);
        const currentRadius = currentFS / 2.4;

        const grp = gCombined.append("g")
          .datum(combinedData)
          .attr("class", "item-group combined")
          .attr("transform", `translate(${newXScale(getDimensionValueX(first))}, ${newYScale(getDimensionValueY(first))})`);

        grp.append('rect').attr('class', 'hit-area')
          .attr('fill', 'transparent').style('cursor', 'pointer')
          .attr('x', -currentRadius - 5)
          .attr('y', -currentFS)
          .attr('height', currentFS * 2)
          .attr('width', (combinedDisplayName.length * currentFS * 0.6 + currentRadius + 20));

        grp.append('rect').attr('class', 'label-bg')
          .attr('rx', 4).attr('ry', 4).attr('fill', 'black').attr('opacity', 0)
          .attr('x', 8)
          .attr('y', -currentFS * 0.7)
          .attr('height', currentFS * 1.5)
          .attr('width', (combinedDisplayName.length * currentFS * 0.6 + 6));

        grp.append('circle').attr('cx', 0).attr('cy', 0)
          .attr('r', currentRadius)
          .attr('fill', colorScale(getLocalized(first.category, LANGUAGE)));

        // Build label with individual colors for names, slash colored by following label
        const textEl = grp.append('text').attr('class', 'label')
          .attr('x', 10).attr('y', 0).attr('dy', '.35em')
          .style('font-family', 'monospace')
          .style('font-size', `${currentFS}px`);

        members.forEach((m, i) => {
          const name = getLocalized(m.displayName, LANGUAGE);
          const cat = getLocalized(m.category, LANGUAGE);
          textEl.append('tspan').text(name).attr('fill', colorScale(cat));
          if (i < members.length - 1) {
            // Slash colored by the next label's category
            const nextCat = getLocalized(members[i + 1].category, LANGUAGE);
            textEl.append('tspan').text(' / ').attr('fill', colorScale(nextCat));
          }
        });

        grp.on("click", (event) => {
          showInfobox(combinedData);
          event.stopPropagation();
        });
      }
    });
  }

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
    if (currentDimensionX !== "none") {
      yScale.range([height - fadeBottomHeight, 50]);
    } else {
      yScale.range([height - 50, 50]);
    }
    if (currentDimensionX === "none") {
      const initialDecadeHeight = Math.abs(yScale(10) - yScale(1));
      const screenCenter = width / 2;
      const xCenter = (xScale.domain()[0] + xScale.domain()[1]) / 2;
      xScale.range([screenCenter, screenCenter + initialDecadeHeight]);
    } else {
      xScale.range([fadeEnd, width - paddingRight]);
    }

    updateMask();

    // Update legend pos
    const legendX = width - legendWidth - 20;
    const legendY = height - legendHeight - 60;
    legend.attr("transform", `translate(${legendX}, ${legendY})`);

    // Refresh zoom
    const t = d3.zoomTransform(svg.node());
    svg.call(zoom.transform, t);
  });

});
