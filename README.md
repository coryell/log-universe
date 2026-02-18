# log(Universe)

An interactive visualization of the scales of the universe.

## Setup and Development

This project uses **Vite** for local development. Due to security restrictions in modern browsers (CORS), you cannot open the `index.html` file directly from the file system.

### Prerequisites

- [Node.js](https://nodejs.org/) installed on your machine.

### Installation

1. Install dependencies:
   ```bash
   npm install
   ```

### Running the Development Server

To start the development server and view the application:

1. Run the dev command:
   ```bash
   npm run dev
   ```
2. Open your browser and navigate to the URL provided in the terminal (usually `http://localhost:5173`).

## Data Notes

- **Sizes**: Sizes of spherical objects in the dataset are represented as **radii**, not diameters.

## Project Structure

- `main.js`: Core logic for the visualization.
- `index.html`: Main entry point.
- `style.css`: Application styling.
- `modules/`: JavaScript modules for various functionalities (constants, utils, etc.).
- `data_editor/`: Components for editing the project's data.
