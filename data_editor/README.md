# Data Editor

A simple web-based editor for modifying the main dataset (`public/data.json`).

## How to Run

From the project root directory, run:

```bash
npm run data-editor
```

Or manually:

```bash
node data_editor/server.js
```

## Usage

1.  Open your browser to [http://localhost:3000](http://localhost:3000).
2.  The editor will load the current data from `public/data.json`.
3.  Make your changes in the spreadsheet-like interface.
4.  Click **Save Data** to write changes back to `public/data.json`.

## Technical Details

-   **Server**: A lightweight Express server (`server.js`) that handles reading/writing the JSON file.
-   **Client**: A vanilla JS frontend (`index.html`) that fetches data and posts updates.
-   **Data Location**: Reads from and writes exclusively to `../public/data.json`.

## License

Distributed under the MIT License. See `LICENSE` for more information.

Copyright (c) 2026 Cutter Coryell
