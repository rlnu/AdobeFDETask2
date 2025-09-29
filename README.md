# Campaign Creative Generator

## How to Run

```
node campaign-gen.mjs --brief /path/on/dropbox/campaign.json --assets /assets --output /output
```

- `--brief` should be a Dropbox path (e.g. `/campaign.json` or `/campaign.yaml`)
- `--assets` should be a Dropbox folder path (e.g. `/assets`)
- `--output` is a local output folder (creatives are also uploaded to Dropbox under this folder name)

## Example Input (campaign.json)

```json
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
```

## Output

- Output folder is organized by product and aspect ratio.
- Each creative is a PNG with the campaign message overlaid.
- All creatives are also uploaded to Dropbox under `/output/ProductName/aspect/creative.png`.

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