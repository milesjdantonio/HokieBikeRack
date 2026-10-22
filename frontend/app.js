// Demo-only behavior. Replace with authenticated API calls after backend security is implemented.
const demoEvents = [
  {time:"Demo",rack:"Rack A",event:"Vibration threshold exceeded",severity:"Medium",status:"Review"},
  {time:"Demo",rack:"Rack B",event:"Device heartbeat received",severity:"Info",status:"Recorded"},
  {time:"Demo",rack:"Rack A",event:"Access granted (sample)",severity:"Info",status:"Recorded"}
];
function renderDemo() {
  const body = document.querySelector("#events-table");
  body.replaceChildren();
  for (const event of demoEvents) {
    const row = document.createElement("tr");
    for (const value of [event.time,event.rack,event.event]) {
      const cell = document.createElement("td"); cell.textContent = value; row.appendChild(cell);
    }
    const severity = document.createElement("td");
    const badge = document.createElement("span"); badge.className = "severity"; badge.textContent = event.severity;
    severity.appendChild(badge); row.appendChild(severity);
    const status = document.createElement("td"); status.textContent = event.status; row.appendChild(status);
    body.appendChild(row);
  }
  document.querySelector("#rack-count").textContent = "2";
  document.querySelector("#online-count").textContent = "1";
  document.querySelector("#alert-count").textContent = "1";
}
document.querySelector("#refresh-button").addEventListener("click", renderDemo);
renderDemo();
// TODO: API loading/error states, authenticated fetches, and backend-enforced permissions.
