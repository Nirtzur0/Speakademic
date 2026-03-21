# Troubleshooting

## Server Issues

### "Kokoro server not found"

**Cause**: The TTS server is not running on port 8880.

**Fix**:
```bash
cd server
./start-server.sh
```

If Docker is not running, start Docker Desktop first.

### Server starts but never becomes healthy

**Cause**: Model is still downloading or loading.

**Fix**: Wait up to 2 minutes on first run. Check logs:
```bash
docker compose -f server/docker-compose.yml logs -f
```

### Port 8880 already in use

**Fix**:
```bash
# Find what's using the port
lsof -i :8880

# Kill it or change the port in docker-compose.yml
```

## Extension Issues

### Extension popup shows "Server offline"

1. Check the server is running: `curl http://localhost:8880/v1/audio/voices`
2. If using a custom server URL, verify it in Settings (right-click icon → Options)

### "No text found in this PDF"

**Cause**: The PDF is scanned/image-based (no selectable text).

**Fix**: Use a PDF with selectable text, or run OCR on the PDF first (e.g., with Adobe Acrobat or `ocrmypdf`).

### "This PDF is password-protected"

**Fix**: Open the PDF in a viewer that can remove the password, save an unprotected copy, then try again.

### "File access not enabled"

**Cause**: Chrome blocks extensions from accessing `file://` URLs by default.

**Fix**:
1. Go to `chrome://extensions`
2. Find Kokoro PDF Reader → Details
3. Enable "Allow access to file URLs"

### Keyboard shortcuts don't work

- Shortcuts only work when the PDF page is focused (click on the PDF first)
- Global shortcuts (Alt+Shift+P, Alt+Shift+S) work from any page
- To customize: `chrome://extensions/shortcuts`

### Audio doesn't play

1. Check Chrome isn't muting the tab (speaker icon in tab)
2. Check system volume
3. Try stopping and clicking Play again

### Text reads in wrong order

**Cause**: Complex multi-column layouts can confuse the column detector.

**Workaround**: The column detection works best on standard 2-column academic formats (IEEE, ACM). 3+ column layouts may read incorrectly.

### Extension doesn't appear on PDF page

**Cause**: The floating overlay only appears after clicking Play.

**Fix**: Click the extension icon in the toolbar and press Play.

## Performance Issues

### Audio gaps between chunks

- The pre-buffer pipeline fetches 3 chunks ahead. If you still hear gaps:
  - Check server performance: generation should be >3x real-time
  - Try a faster machine or reduce playback speed
  - Check Docker resource limits (CPU allocation)

### Slow text extraction on large PDFs

- PDFs over 100 pages may take several seconds to extract
- The extraction runs once; subsequent play/pause is instant
