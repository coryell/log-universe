// Copyright (c) 2026 Cutter Coryell
// SPDX-License-Identifier: MIT

import { getMatches, getSearchResultContent } from './search.js';
import { getLocalized } from './utils.js';

export function createSearchUI(inputSelector, resultsSelector, options) {
    const searchInput = document.querySelector(inputSelector);
    const searchResults = document.querySelector(resultsSelector);
    const { data, language, onSelect, onEscape, getFilteredData, currentDimensionX, currentDimensionY } = options;

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
            div.innerHTML = getSearchResultContent(d, query, language);

            div.addEventListener('click', (e) => {
                e.stopPropagation();
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
        if (onSelect) onSelect(result);
        searchInput.value = getLocalized(result.displayName, language);
        searchResults.style.display = 'none';
        searchInput.blur();
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

    searchInput.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    // Input Events
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value;
        const matches = getMatches(data(), query, language);
        const filtered = getFilteredData ? getFilteredData(matches, currentDimensionX(), currentDimensionY()) : matches;
        renderResults(filtered, query);
    });

    searchInput.addEventListener('focus', () => {
        const query = searchInput.value;
        if (query) {
            const matches = getMatches(data(), query, language);
            const filtered = getFilteredData ? getFilteredData(matches, currentDimensionX(), currentDimensionY()) : matches;
            renderResults(filtered, query);
        }
        searchResults.scrollTop = 0;
    });

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            searchResults.style.display = 'none';
            searchInput.blur();
            if (onEscape) onEscape();
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
            const query = searchInput.value;
            const matches = getMatches(data(), query, language);
            const filtered = getFilteredData ? getFilteredData(matches, currentDimensionX(), currentDimensionY()) : matches;

            if (selectedIndex >= 0) {
                if (filtered[selectedIndex]) selectResult(filtered[selectedIndex]);
            } else if (filtered.length > 0) {
                selectResult(filtered[0]);
            }
            e.preventDefault();
        }
    });

    // Global click to close
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
            searchResults.style.display = 'none';
        }
    });

    // Hotkeys handled globally
    document.addEventListener('keydown', (e) => {
        if (document.activeElement === searchInput) return;

        // Ctrl/Cmd + F
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            e.preventDefault();
            searchInput.focus();
            return;
        }

        if (e.altKey) return;

        // Escape handled by onEscape in main.js or here?
        // In main.js Escape hides infobox.

        // Quick Search (type to focus)
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            // Check if not in another input
            if (document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
                searchInput.focus();
            }
        }

        // Delete/Backspace to clear
        if (document.activeElement === searchInput && (e.key === 'Delete' || e.key === 'Backspace') && searchInput.value === '') {
            // Already handled by input listener if value changes, 
            // but this is for specific "clear and focus" behavior if needed.
        }
    });

    return {
        focus: () => searchInput.focus(),
        clear: () => {
            searchInput.value = '';
            renderResults([], '');
        },
        hide: () => {
            searchResults.style.display = 'none';
        },
        setValue: (val) => {
            searchInput.value = val;
        }
    };
}
