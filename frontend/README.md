# Admin frontend

Plain HTML/CSS/JavaScript modules, no build step. The backend serves this folder at
http://localhost:8080/. Explained in [../docs/notes/frontend.md](../docs/notes/frontend.md).

Pages: Overview (live), Events, Racks (devices + tokens), Cards, Reports, Audit log,
plus **📱 App preview** (phone-style Rider and Admin apps using live data).

All privileged actions are enforced by the backend; the UI only hides buttons for
the read-only viewer. Never put secrets in these files.

Likely to generated entirely by Claude - Miles
