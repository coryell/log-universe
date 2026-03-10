// Copyright (c) 2026 Cutter Coryell
// SPDX-License-Identifier: MIT

import * as d3 from 'd3';
import { getLocalized, getUnit, getLabelWithIsotopeOverride } from './utils.js';
import { categories, checkMobile } from './constants.js';

export function createInfobox(selection) {
    const infobox = selection.append("div")
        .attr("class", "infobox")
        .style("display", "none")
        .on("click", (event) => {
            event.stopPropagation();
        });

    function show(d, config) {
        const {
            currentDimensionX,
            currentDimensionY,
            colorScale,
            language,
            positionMode = 'bottom' // 'top' or 'bottom'
        } = config;

        // Smart Positioning (Mobile Only)
        // We use matchMedia here to stay consistent with CSS
        if (checkMobile()) {
            if (positionMode === 'top') {
                const headerHeight = document.querySelector('header') ? document.querySelector('header').offsetHeight : 60;
                infobox.style("bottom", "auto").style("top", (headerHeight + 10) + "px");
            } else {
                infobox.style("top", "auto").style("bottom", "10px");
            }
        } else {
            // Reset to default CSS for desktop (bottom-left)
            infobox.style("top", null).style("bottom", null);
        }

        const members = d._isCombined ? d._members : [d];
        let fullContent = "";

        members.forEach((member, index) => {
            let localizedDisplayName = getLocalized(member.displayName, language);
            const tags = (member.tags && member.tags[language]) || [];
            localizedDisplayName = getLabelWithIsotopeOverride(localizedDisplayName, tags, currentDimensionX, currentDimensionY);

            const categoryKey = getLocalized(member.category, language);
            const categoryDisplayName = categories[categoryKey]?.displayName[language] ?? categoryKey;
            let tagsContent = "";
            if (member.tags && member.tags[language]) {
                tagsContent = `<div class="infobox-row"><span class="infobox-label">Tags:</span>${member.tags[language].join(", ")}</div>`;
            }

            // Build dimensions content
            let dimsContent = "";

            const formatDimension = (val) => {
                if (val === undefined || val === null) return "";

                const formatSingle = (v) => {
                    let s = v.toString().toLowerCase();
                    let prefix = "";
                    if (s.startsWith('>') || s.startsWith('<')) {
                        prefix = s[0] + " ";
                        s = s.slice(1);
                    }
                    if (s.includes('e')) {
                        const parts = s.split('e');
                        const coeff = parts[0];
                        const exp = parseInt(parts[1], 10);
                        return `${prefix}${coeff} × 10^${exp}`;
                    }
                    return `${prefix}${s}`;
                };

                if (Array.isArray(val)) {
                    return `${formatSingle(val[0])} – ${formatSingle(val[1])}`;
                }
                return formatSingle(val);
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
                        const s = member.sources[dim];
                        const link = Array.isArray(s) ? s[0] : s;
                        sourceLink = `<button class="copy-btn" onclick="window.open('${link}', '_blank')">Source</button>`;
                    }

                    return `<div class="infobox-row"><span class="infobox-label">${label}:</span>${txt}<button class="copy-btn" data-copy-text="${txt}">Copy</button>${sourceLink}</div>`;
                }
                return "";
            };

            // Always show Y dimension
            dimsContent += addDimRow(currentDimensionY);
            // Show X dimension if selected and DIFFERENT from Y
            if (currentDimensionX !== "none" && currentDimensionX !== currentDimensionY) {
                dimsContent += addDimRow(currentDimensionX);
            }

            const categoryColor = colorScale(categoryKey);

            const entrySeparator = (index > 0) ? '<div class="infobox-divider"></div>' : '';

            fullContent += `
        ${entrySeparator}
        <div class="infobox-entry" data-id="${member.id}">
          <div class="infobox-title">${localizedDisplayName}</div>
          ${member.description && getLocalized(member.description, language) ? `<div class="infobox-description">${getLocalized(member.description, language)}</div>` : ''}
          ${dimsContent}
          <div class="infobox-row"><span class="infobox-label">Category:</span><span style="color: ${categoryColor}">${categoryDisplayName}</span></div>
          ${tagsContent}
        </div>
      `;
        });

        infobox.html(fullContent).style("display", "block");

        // Attach copy event listeners
        infobox.selectAll(".copy-btn").on("click", function (event) {
            event.stopPropagation(); // Stop propagation to prevent closing
            const textToCopy = d3.select(this).attr("data-copy-text");
            if (!textToCopy) return; // Skip Source buttons if handled inline

            // Fallback function for iOS/older browsers
            const copyToClipboardFallback = (text) => {
                const textArea = document.createElement("textarea");
                textArea.value = text;
                // Avoid scrolling to bottom
                textArea.style.top = "0";
                textArea.style.left = "0";
                textArea.style.position = "fixed";
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();

                try {
                    const successful = document.execCommand('copy');
                    if (successful) {
                        showCopyFeedback(d3.select(this));
                    } else {
                        console.error('Fallback: Copying text command was unsuccessful');
                    }
                } catch (err) {
                    console.error('Fallback: Oops, unable to copy', err);
                }
                document.body.removeChild(textArea);
            };

            const showCopyFeedback = (btn) => {
                const originalText = btn.text();
                btn.text("Copied!");
                setTimeout(() => {
                    btn.text(originalText);
                }, 2000);
            };

            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(textToCopy).then(() => {
                    showCopyFeedback(d3.select(this));
                }).catch(err => {
                    console.warn('Clipboard API failed, trying fallback:', err);
                    copyToClipboardFallback(textToCopy);
                });
            } else {
                copyToClipboardFallback(textToCopy);
            }
        });
    }

    function hide() {
        infobox.style("display", "none");
    }

    return { show, hide };
}
