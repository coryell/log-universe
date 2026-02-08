import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;
const dataPath = path.join(__dirname, '..', 'public', 'data.json');

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname), { index: false })); // Serve index.html from root if desired, or simpler below

// Serve editor
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Get Data
app.get('/data', (req, res) => {
    try {
        const raw = fs.readFileSync(dataPath, 'utf8');
        const data = JSON.parse(raw);
        res.json(data);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// Save Data
app.post('/save', (req, res) => {
    try {
        const newData = req.body;
        // Stringify with indentation
        const jsonString = JSON.stringify(newData, null, 2);
        fs.writeFileSync(dataPath, jsonString, 'utf8');
        console.log("Data saved successfully.");
        res.sendStatus(200);
    } catch (err) {
        console.error("Save error", err);
        res.status(500).send(err.message);
    }
});

app.listen(port, () => {
    console.log(`Editor running at http://localhost:${port}`);
});
