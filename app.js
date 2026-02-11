fetch("data/demo.json")
  .then(res => res.json())
  .then(data => {
    const w = data.whatsGoingOn;

    // Filter polling: show parties >= 2%, and always include SNP if present
    const polling = (w.polling || [])
      .filter(p => p.value >= 2 || p.party === "SNP")
      .sort((a,b) => b.value - a.value);

    const pollingLines = polling
      .map(p => `<div class="row"><span>${p.party}</span><b>${p.value.toFixed(1)}%</b></div>`)
      .join("");

    const billsLines = (w.commonsLegislation || [])
      .slice(0, 4)
      .map(b => `<div class="row"><span>${b.title}</span><b>${b.stage}</b></div>`)
      .join("");

    const html = `
      <div class="wgo-grid">
        <div class="wgo-tile">
          <div class="wgo-kicker">BBC News</div>
          <div class="wgo-title">${w.bbc.headline}</div>
          <div class="wgo-strap">${w.bbc.strap}</div>
          <div class="wgo-actions"><a class="btn" href="#">Open</a></div>
        </div>

        <div class="wgo-tile">
          <div class="wgo-kicker">Papers</div>
          <div class="wgo-title">${w.papers.paper}: ${w.papers.headline}</div>
          <div class="wgo-strap">${w.papers.strap}</div>
          <div class="wgo-actions"><a class="btn" href="#">View Front Page</a></div>
        </div>

        <div class="wgo-tile">
          <div class="wgo-kicker">Economy</div>
          <div class="wgo-metric">
            <div class="row"><span>Growth</span><b>${w.economy.growth.toFixed(1)}%</b></div>
            <div class="row"><span>Inflation</span><b>${w.economy.inflation.toFixed(1)}%</b></div>
            <div class="row"><span>Unemployment</span><b>${w.economy.unemployment.toFixed(1)}%</b></div>
          </div>
          <div class="wgo-actions"><a class="btn" href="#">Economy</a></div>
        </div>

        <div class="wgo-tile">
          <div class="wgo-kicker">Polling</div>
          <div class="wgo-metric">
            ${pollingLines || `<div class="wgo-strap">No polling yet.</div>`}
          </div>
          <div class="wgo-actions"><a class="btn" href="#">Polling</a></div>
        </div>

        <div class="wgo-tile">
          <div class="wgo-kicker">Commons Legislation</div>
          <div class="wgo-metric">
            ${billsLines || `<div class="wgo-strap">No items on the Order Paper.</div>`}
          </div>
          <div class="wgo-actions"><a class="btn" href="bill.html">Legislation</a></div>
        </div>
      </div>
    `;

    document.getElementById("whats-going-on").innerHTML = html;

    // Keep placeholders for now
    const op = document.getElementById("order-paper");
    if (op) op.innerHTML = "";
    const econ = document.getElementById("economy");
    if (econ) econ.innerHTML = "";
  });
