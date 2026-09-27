// ISP-148 (AB#842): the credit rating card. Pure: turns a rating into HTML, so it can be tested without a browser.
//
// Two shapes, one look. The player's own card (the Finance tab) reads corp.creditRating in full and says, in one line,
// what holds the grade back most. A counterparty's card (the loan board, the bond board, the Stock Exchange: v0.9's
// boards, which call ratingCardHtml when they are built) reads the public view from
// GET /api/corporations/:corpId/credit-rating: the grade, a score band and each input's band, never raw values.

import { escapeHtml } from "./html.js";

/** The inputs in the design's order (docs/design/v0.9-debt.md, section 4), with what raises each. */
export const RATING_INPUTS = Object.freeze([
  { id: "history", label: "History", raise: "a longer record of daily statements raises it" },
  { id: "cashCover", label: "Cash cover", raise: "more credits against daily costs raises it" },
  { id: "margin", label: "Margin", raise: "keeping more of what you earn raises it" },
  { id: "solvency", label: "Solvency", raise: "more net worth against what you owe raises it" },
  { id: "leverage", label: "Leverage", raise: "less debt against income raises it" },
  { id: "turnover", label: "Turnover", raise: "more income from what you hold raises it" }
]);

/** A grade's family, for its colour: A grades, B grades, C grades, D, and NR. */
export function gradeTone(grade) {
  if (grade === "NR" || !grade) return "unrated";
  if (grade === "D") return "default";
  return { A: "strong", B: "fair", C: "weak" }[grade[0]] ?? "unrated";
}

/**
 * What holds a rating back most, as one line: a cap if one applies (it outranks the score), otherwise the input that
 * costs the most points (weight x (1 - sub-score)).
 */
export function ratingWhy(rating) {
  if (rating?.caps?.length) return `Capped by ${rating.caps[0]}.`;
  const inputs = rating?.inputs || {};
  let worst = null;
  for (const i of RATING_INPUTS) {
    const x = inputs[i.id];
    if (!x) continue;
    const lost = (Number(x.weight) || 0) * (1 - (Number(x.sub) || 0));
    if (!worst || lost > worst.lost) worst = { ...i, lost };
  }
  if (!worst || worst.lost <= 0) return "Every input is at its best.";
  return `Weakest: ${worst.label.toLowerCase()}; ${worst.raise}.`;
}

/** "Not rated: N more days of history needed" for an NR rating (or none yet). */
export function notRatedLine(rating) {
  const need = Number(rating?.need) || 7;
  const have = Math.max(0, Number(rating?.have) || 0);
  const more = Math.max(1, need - have);
  return `Not rated: ${more} more ${more === 1 ? "day" : "days"} of history needed`;
}

const gradeBlock = (grade) => `<span class="rating-card__grade rating-card__grade--${gradeTone(grade)}" data-grade="${escapeHtml(grade)}">${escapeHtml(grade)}</span>`;

/** The player's own card, from corp.creditRating (or nothing yet: NR). */
export function ownRatingCardHtml(rating) {
  if (!rating || rating.grade === "NR" || !Number.isFinite(rating.score)) {
    return `<div class="rating-card rating-card--own" data-rating="NR">
  ${gradeBlock("NR")}
  <div class="rating-card__body">
    <p class="rating-card__title">Credit rating</p>
    <p class="rating-card__why" data-why>${escapeHtml(notRatedLine(rating))}</p>
  </div>
</div>`;
  }
  return `<div class="rating-card rating-card--own" data-rating="${escapeHtml(rating.grade)}">
  ${gradeBlock(rating.grade)}
  <div class="rating-card__body">
    <p class="rating-card__title">Credit rating <span class="rating-card__score" data-score="${rating.score}">${rating.score} / 1,000</span></p>
    <p class="rating-card__why" data-why>${escapeHtml(ratingWhy(rating))}</p>
  </div>
</div>`;
}

/**
 * A counterparty's card, from the public view: { corpId, corporationName, grade, scoreBand, inputs, computedAt }.
 * The inputs are bands (strong, fair, weak), listed so a lender sees which part of the record is thin.
 */
export function ratingCardHtml(pub) {
  const name = escapeHtml(pub?.corporationName || "");
  if (!pub || pub.grade === "NR" || !pub.scoreBand) {
    return `<div class="rating-card rating-card--counterparty" data-rating="NR">
  ${gradeBlock("NR")}
  <div class="rating-card__body"><p class="rating-card__title">${name}</p><p class="rating-card__why">Not rated: too little history to price</p></div>
</div>`;
  }
  const bands = RATING_INPUTS.filter((i) => pub.inputs?.[i.id])
    .map((i) => `<li class="rating-card__input rating-card__input--${escapeHtml(pub.inputs[i.id])}">${escapeHtml(i.label)} <span>${escapeHtml(pub.inputs[i.id])}</span></li>`).join("");
  return `<div class="rating-card rating-card--counterparty" data-rating="${escapeHtml(pub.grade)}">
  ${gradeBlock(pub.grade)}
  <div class="rating-card__body">
    <p class="rating-card__title">${name} <span class="rating-card__score">score ${escapeHtml(pub.scoreBand)}</span></p>
    <ul class="rating-card__inputs">${bands}</ul>
  </div>
</div>`;
}
