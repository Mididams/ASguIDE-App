const EMERGENCY_MEMO_SECTIONS = [
  {
    title: "Les mémos médicaments d'urgences",
    linkLabel: "Fiches mémos médicaments d'urgences",
    href: "./html/memo-medicaments-urgences.html",
    description: "Adrénaline, Atropine, Célocurine, Ephédrine, Etomidate, isuprel, Kétamine, Midazolam, Noradrénaline, Sufentanil."
  },
  {
    title: "Les mémos Antibiotiques",
    linkLabel: "Fiches mémos antibiotiques",
    href: "./html/memo-antibiotiques.html",
    description: "Amikacine, Azactam, Bactrim, Cefotaxime, Clindamycine, Cloxacilline, Erythrocine, Gentamycine, Linézolide, Rovamycine, Vancomycine.",
    secondaryLinkLabel: "Fiches complètes SMIT",
    secondaryHref: "./html/memo-SMIT.html"
  },
  {
    title: "Les mémos Médicaments",
    linkLabel: "Fiches mémos médicaments",
    href: "./html/memo-medicaments.html",
    description: "Phocytan."
  }
];

function renderEmergencyMemoCard(section) {
  return `
    <article class="emergency-link-card">
      <p class="section-kicker">Mémo</p>
      <h3>${section.title}</h3>
      <a class="emergency-link-anchor" href="${section.href}" target="_blank" rel="noreferrer">
        ${section.linkLabel}
      </a>
      <p class="emergency-link-description">${section.description}</p>
      ${
        section.secondaryLinkLabel && section.secondaryHref
          ? `
            <a class="emergency-link-anchor" href="${section.secondaryHref}" target="_blank" rel="noreferrer">
              ${section.secondaryLinkLabel}
            </a>
          `
          : ""
      }
    </article>
  `;
}

export async function renderCardsView(container) {
  container.innerHTML = `
    <div class="stack emergency-view">
      <div class="info-card emergency-hero">
        <p class="section-kicker">Médocs d'urgence</p>
        <strong>Mémos et fiches prioritaires</strong>
      </div>

      <section class="stack">
        <div class="emergency-link-grid">
          ${EMERGENCY_MEMO_SECTIONS.map(renderEmergencyMemoCard).join("")}
        </div>
      </section>
    </div>
  `;
}
