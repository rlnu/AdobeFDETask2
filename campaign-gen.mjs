/**
 * Campaign Creative Generator
 * 
 * Requirements:
 * - Accepts a campaign brief (JSON or YAML)
 * - Accepts input assets (local folder)
 * - Generates missing assets using OpenAI DALL·E (GenAI)
 * - Produces creatives for 1:1, 9:16, 16:9 aspect ratios
 * - Overlays campaign message (English, optionally localized)
 * - Saves outputs organized by product and aspect ratio
 * - Simple CLI tool
 * 
 * Usage:
 *   node campaign-gen.js --brief campaign.json --assets ./assets --output ./output
 * 
 * Example campaign.json:
 * {
   {
   "products": [
     { "name": "Coffee", "description": "Coffee mug in the backdrop of crisp autumn landscape with colorful trees" },
     { "name": "Candle", "description": "A candle in the backdrop of colorful autumn trees" },
     { "name": "Jacket", "description": "A stylish autumn jacket" }
   ],
   "target_region": "US",
   "target_audience": "Active adults 18-50",
   "campaign_message": "Your cozy fall ritual starts here."
  }
}
 * 
 * Requirements: 
 *   - Set OPENAI_API_KEY in your environment
 *   - npm install openai jimp yargs fs-extra yaml chalk
 */
/*
 * Note: Console log statements will be added at the start of each method to indicate code execution.
 */

   import 'dotenv/config';
   import fs from 'fs-extra';
   import path from 'path';
   import { Jimp } from 'jimp';
   import OpenAIApi from 'openai';
   import yargs from 'yargs';
   import { hideBin } from 'yargs/helpers';
   import yaml from 'yaml';
   import { loadFont } from "@jimp/plugin-print/load-font";
   import { SANS_64_WHITE } from "jimp/fonts";
   import{ measureText, measureTextHeight } from "@jimp/plugin-print";
   import axios from 'axios';
   import { Dropbox } from "dropbox";
   import fetch from 'node-fetch'; 

// --- Config ---
const ASPECT_RATIOS = {
  '1_1': { w: 1024, h: 1024 },
  '16_9':{ w: 2688, h: 1536 },
  '9_16':{ w: 1440, h: 2560 }
};
//const FONT_PATH = Jimp.FONT_SANS_64_WHITE; // Use built-in Jimp font

// --- CLI Args ---
const argv = yargs(hideBin(process.argv))
  .option('brief', { alias: 'b', describe: 'Path to campaign brief (JSON or YAML)', demandOption: true, type: 'string' })
  .option('assets', { alias: 'a', describe: 'Path to input assets folder', demandOption: true, type: 'string' })
  .option('output', { alias: 'o', describe: 'Path to output folder', demandOption: true, type: 'string' })
  .help()
  .argv;

// --- OpenAI Setup ---
const openai = new OpenAIApi({
  apiKey: process.env.OPENAI_API_KEY, // Make sure to replace this with your actual API key or use process.env
});

// Load credentials from .env
const APP_KEY = process.env.DROPBOX_APP_KEY;
const APP_SECRET = process.env.DROPBOX_APP_SECRET;
const REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN;


// 🔑 Get access token from refresh token
async function getAccessToken() {
  console.log('[DEBUG] Entered getAccessToken');
  const authHeader =
    "Basic " + Buffer.from(`${APP_KEY}:${APP_SECRET}`).toString("base64");

  const response = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: authHeader,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: REFRESH_TOKEN,
    }),
  });

  const data = await response.json();
  if (!data.access_token) {
    throw new Error("❌ Failed to get access token: " + JSON.stringify(data));
  }
  return data.access_token;
}

async function getDropboxInstance() {
  console.log('[DEBUG] Entered getDropboxInstance');
  const accessToken = await getAccessToken();
  return new Dropbox({ accessToken, fetch: fetch });
}

const dbx = await getDropboxInstance();


// --- Helper: Load Campaign Brief from dropbox ---
async function loadBrief(filePath) {
  console.log('[DEBUG] Entered loadBrief');
  // Assuming 'fetch' is defined and available (required for Node.js environments)

  const ext = path.extname(filePath).toLowerCase();

  try {
      console.log(`Attempting to download: ${filePath}`);

      // Execute download
      const response = await dbx.filesDownload({ path: filePath });
      
      // Convert binary to string
      let fileContent;
      const fileBinary = response.result.fileBinary;
      
      if (fileBinary instanceof Buffer) {
          fileContent = fileBinary.toString('utf8');
      } else if (fileBinary instanceof ArrayBuffer) {
          fileContent = Buffer.from(fileBinary).toString('utf8');
      } else {
          throw new Error("Unknown fileBinary type from Dropbox");
      }
      
      // --- CRITICAL DEBUGGING STEP ---
      console.log("--- START RAW FILE CONTENT (Length: " + fileContent.length + " chars) ---");
      console.log(fileContent);
      console.log("--- END RAW FILE CONTENT ---");
      // -------------------------------

      // Check if the file is empty before parsing
      if (fileContent.trim().length === 0) {
          console.warn(`File content is empty or only whitespace. Returning empty object.`);
          return {};
      }

      if (ext === '.json') {
          return JSON.parse(fileContent); // Will throw SyntaxError if not valid JSON
      }
      if (ext === '.yaml' || ext === '.yml') {
          // Note: Make sure 'yaml' module is imported and working (e.g., using 'js-yaml' or similar)
          return yaml.parse(fileContent); 
      }

      throw new Error('Unsupported brief format. Use JSON or YAML.');

  } catch (err) {
      // Log the full error from the Dropbox API for better diagnosis
      console.error("Dropbox API Error Details:", err); 
      
      let message = `Failed to download brief from Dropbox: ${filePath}`;
      if (err.error && err.error.error_summary) {
          message += ` - ${err.error.error_summary}`;
      } else {
          message += ` - ${err.message}`;
      }
      throw new Error(message);
  }
}

// --- Helper: Find or Generate Asset (Dropbox version) ---
async function getProductAsset(product, assetsDir, outputDir) {
  console.log('[DEBUG] Entered getProductAsset');
  // assetsDir is a Dropbox folder path, e.g. "/assets"

  // List files in the Dropbox assetsDir
  let files;
  try {
    const listRes = await dbx.filesListFolder({ path: assetsDir });
    files = listRes.result.entries
      .filter(e => e[".tag"] === "file")
      .map(e => e.name);
  } catch (err) {
    throw new Error(`Failed to list assets in Dropbox: ${err.message}`);
  }

  // Try to find an image in assetsDir matching product name (case-insensitive, jpg/png)
  const regex = new RegExp(product.name.replace(/\s+/g, ''), 'i');
  const found = files.find(f => regex.test(f.replace(/\.[^.]+$/, '')) && /\.(png|jpg|jpeg)$/i.test(f));
  if (found) {
    // Download the file from Dropbox to a local temp file in outputDir
    const dropboxFilePath = path.posix.join(assetsDir, found);
    let fileBinary;
    try {
      const resp = await dbx.filesDownload({ path: dropboxFilePath });
      if (resp.result.fileBinary instanceof Buffer) {
        fileBinary = resp.result.fileBinary;
      } else if (resp.result.fileBinary instanceof ArrayBuffer) {
        fileBinary = Buffer.from(resp.result.fileBinary);
      } else {
        throw new Error("Unknown fileBinary type from Dropbox");
      }
    } catch (err) {
      throw new Error(`Failed to download asset from Dropbox: ${err.message}`);
    }
    const outPath = path.join(outputDir, found);
    await fs.writeFile(outPath, fileBinary);
    return outPath;
  }

  // Not found: generate with DALL·E
  console.log(`Asset for "${product.name}" not found in Dropbox. Generating with DALL·E...`);
  const prompt = `Product photo: ${product.name}. ${product.description || ''}`;
  const response = await openai.images.generate({
    model: 'dall-e-3',
    prompt,
    n: 1,
    size: "1024x1024"
  });
  const imageUrl = response.data[0].url;
  // Download image
  const imgResp = await axios.get(imageUrl, { responseType: 'arraybuffer' });
  const outFileName = `${product.name.replace(/\s+/g, '_')}_gen.png`;
  const outPath = path.join(outputDir, outFileName);
  await fs.writeFile(outPath, imgResp.data);

  // Optionally, upload the generated image back to Dropbox assetsDir for future use
  try {
    await dbx.filesUpload({
      path: path.posix.join(assetsDir, outFileName),
      contents: imgResp.data,
      mode: { ".tag": "add" }, // don't overwrite
      autorename: true
    });
  } catch (err) {
    console.warn(`Warning: Failed to upload generated asset to Dropbox: ${err.message}`);
  }

  return outPath;
}


/**
 * Overlay a message on an image and upload the result to Dropbox.
 * @param {string} imagePath - Local path to the input image.
 * @param {string} message - The message to overlay.
 * @param {string} aspect - Aspect ratio key.
 * @param {string} outputPath - Local path to save the output image (still saves locally for compatibility).
 * @param {string} [dropboxDestPath] - Dropbox path to upload the result (e.g., '/output/creative.png').
 */
async function overlayMessage(imagePath, message, aspect, outputPath, dropboxDestPath) {
  console.log('[DEBUG] Entered overlayMessage');
  const { w, h } = ASPECT_RATIOS[aspect];
  let img = await Jimp.read(imagePath);
  img.cover({ w: w, h: h });
  const font = await loadFont(SANS_64_WHITE);

  // Draw message at bottom center
  const textWidth = measureText(font, message);
  const textHeight = measureTextHeight(font, message, w);
  const x = (w - textWidth) / 2;
  const y = h - textHeight - 40;

  img.print({
    font: font,
    x: x,
    y: y,
    text: {
      text: message,
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
    },
    maxWidth: textWidth,
    maxHeight: textHeight
  });

  // Write to local disk as before
  await img.write(outputPath);

  // Upload to Dropbox if dropboxDestPath is provided
  if (dropboxDestPath) {
    const imgBuffer = await img.getBuffer("image/png");  
    try {
      await dbx.filesUpload({
        path: dropboxDestPath,
        contents: imgBuffer,
        mode: { ".tag": "overwrite" }, // overwrite existing file
        autorename: true
      });
      console.log(`Uploaded creative to Dropbox: ${dropboxDestPath}`);
    } catch (err) {
      console.warn(`Warning: Failed to upload creative to Dropbox: ${err.message}`);
    }
  }
}

// --- Main ---
// --- Main with Dropbox integration ---
(async () => {
  console.log('[DEBUG] Entered main IIFE');
  try {
    const brief = await(loadBrief(argv.brief));
    const products = brief.products || [];
    if (products.length < 2) throw new Error('At least two products required in brief.');
    const campaignMsg = brief.campaign_message || 'Your Campaign Message Here';

    for (const product of products) {
      const productDir = path.join(".",argv.output, product.name.replace(/\s+/g, '_'));
      await fs.ensureDir(productDir);

      // Get or generate asset
      const assetPath = await getProductAsset(product, argv.assets, productDir);

      // For each aspect ratio, create creative
      for (const aspect of Object.keys(ASPECT_RATIOS)) {
        const aspectDir = path.join(productDir, aspect);
        await fs.ensureDir(aspectDir);
        const outPath = path.join(aspectDir, 'creative.png');

        // Dropbox destination path (e.g., /output/ProductName/aspect/creative.png)
        const dropboxDestPath = `/${path.basename(argv.output)}/${product.name.replace(/\s+/g, '_')}/${aspect}/creative.png`;

        await overlayMessage(assetPath, campaignMsg, aspect, outPath, dropboxDestPath, dbx);
        console.log(`Saved locally: ${outPath} and uploaded to Dropbox: ${dropboxDestPath}`);
      }
    }

    // --- Basic README ---
    const readme = `
# Campaign Creative Generator

## How to Run

\`\`\`
node campaign-gen.mjs --brief /path/on/dropbox/campaign.json --assets /assets --output /output
\`\`\`

- \`--brief\` should be a Dropbox path (e.g. \`/campaign.json\` or \`/campaign.yaml\`)
- \`--assets\` should be a Dropbox folder path (e.g. \`/assets\`)
- \`--output\` is a local output folder (creatives are also uploaded to Dropbox under this folder name)

## Example Input (campaign.json)

\`\`\`json
{
  "products": [
    { "name": "Coffee", "description": "Coffee mug in the backdrop of crisp autumn landscape with colorful trees" },
    { "name": "Candle", "description": "A candle in the backdrop of colorful autumn trees" },
    { "name": "Jacket", "description": "A stylish denim jacket, perfectly centered, hanging on an old wooden fence. The background is a vibrant, sunlit autumn forest with golden, red, and orange leaves." }
  ],
  "target_region": "US",
  "target_audience": "Active adults 18-50",
  "campaign_message": "Your cozy fall ritual starts here."
}
\`\`\`

## Output

- Output folder is organized by product and aspect ratio.
- Each creative is a PNG with the campaign message overlaid.
- All creatives are also uploaded to Dropbox under \`/output/ProductName/aspect/creative.png\`.

## Design Decisions

- Uses OpenAI DALL·E for missing product images.
- Uses Jimp for image resizing and text overlay.
- Accepts JSON or YAML for campaign brief (from Dropbox).
- CLI tool for local use, with Dropbox integration for input/output.
- Downloads assets and brief from Dropbox, uploads creatives to Dropbox.

## Assumptions & Limitations

- Requires OpenAI API key.
- Requires Dropbox App credentials and refresh token in environment variables.
- Only English message overlay.
- No advanced brand compliance or legal checks (can be added).

    `.trim();
    await fs.writeFile(path.join(".",argv.output, 'README.md'), readme);

    console.log('\nAll creatives generated. See README.md in output folder for details.');
  } catch (err) {
    console.error('Error:', err.stack);
    process.exit(1);
  }
})();
