fetch("data/demo.json")
  .then(res => res.json())
  .then(data => {

    // ===== What's Going On =====
    const w = data.whatsGoingOn;

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

    document.getElementById("whats-going-on").innerHTML = `
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

      // ===== Order Paper (Commons) =====
    const stageOrder = [
      "First Reading",
      "Second Reading",
      "Committee Stage",
      "Report Stage",
      "Division"
    ];

    const orderWrap = document.getElementById("order-paper");

    if (orderWrap) {
      const bills = data.orderPaperCommons || [];

      orderWrap.innerHTML = `
        <div class="order-grid">
          ${bills.map(b => `
            <div class="bill-card ${b.status}">
              <div class="bill-title">${b.title}</div>
              <div class="bill-sub">
                Author: ${b.author} · ${b.department}
              </div>

              <div class="stage-track">
                ${stageOrder.map(s => `
                  <div class="stage ${b.stage === s ? "on" : ""}">
                    ${s}
                  </div>
                `).join("")}
              </div>

              ${
                b.status === "passed"
                  ? `<div class="bill-result passed">Royal Assent Granted</div>`
                  : b.status === "failed"
                    ? `<div class="bill-result failed">Bill Defeated</div>`
                    : `<div class="bill-current">Current Stage: <b>${b.stage}</b></div>`
              }

              <div class="bill-actions spaced">
                <a class="btn" href="bill.html?id=${b.id}">View Bill</a>
                <a class="btn" href="https://forum.rulebritannia.org" target="_blank">Debate</a>
              </div>
            </div>
          `).join("")}
        </div>
      `;
    }


    // State of the Nation placeholder stays for now
    const econ = document.getElementById("economy");
    if (econ) econ.innerHTML = "Economy system connected ✓";
  })
  .catch(err => {
    console.error(err);
    const w = document.getElementById("whats-going-on");
    if (w) w.innerHTML = "Error loading demo data. Check demo.json formatting.";
  });
