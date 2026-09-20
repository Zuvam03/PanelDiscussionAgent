"""Start the PanelPrep backend (and serve the built frontend if present)."""

import uvicorn

if __name__ == "__main__":
    uvicorn.run("app.server:app", host="0.0.0.0", port=8001, reload=True)
