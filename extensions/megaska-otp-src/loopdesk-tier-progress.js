function disabledTierProgress(input) {
    return { enabled: false, promotionPublicId: null, currencyCode: String(input.currencyCode || ""), qualifyingSubtotal: Number(input.qualifyingSubtotal) || 0, currentTier: null, nextTier: null, highestTier: null, amountToNextTier: null, progressPercent: 0, tiers: [], state: "BELOW_FIRST_TIER", message: { eyebrow: "", title: "", description: "" } };
}
function buildTierProgressViewModel(input) {
    const subtotal = Number(input.qualifyingSubtotal);
    if (!Number.isFinite(subtotal) || subtotal < 0 || input.selectionMode !== "highest_eligible" || ["continuous", "allow_gaps"].indexOf(input.continuityMode) < 0 || !/^[A-Z]{3}$/.test(input.currencyCode || "") || !Array.isArray(input.tiers) || !input.tiers.length)
        return disabledTierProgress(input);
    const ids = {};
    let tiers = input.tiers.map(function (tier) {
        const maximum = tier.maximumSubtotal === undefined || tier.maximumSubtotal === null ? null : Number(tier.maximumSubtotal);
        return { publicId: String(tier.publicId || ""), position: Number(tier.position), minimumSubtotal: Number(tier.minimumSubtotal), maximumSubtotal: maximum, percentage: Number(tier.percentage), isUnlocked: false, isCurrent: false, isNext: false };
    }).sort(function (a, b) { return a.minimumSubtotal - b.minimumSubtotal || a.position - b.position || a.publicId.localeCompare(b.publicId); });
    for (let index = 0; index < tiers.length; index += 1) {
        const tier = tiers[index];
        const previous = index ? tiers[index - 1] : null;
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(tier.publicId) || ids[tier.publicId] || !Number.isInteger(tier.position) || !Number.isFinite(tier.minimumSubtotal) || tier.minimumSubtotal < 0 || (tier.maximumSubtotal !== null && (!Number.isFinite(tier.maximumSubtotal) || tier.maximumSubtotal <= tier.minimumSubtotal)) || !Number.isFinite(tier.percentage) || tier.percentage <= 0 || tier.percentage > 100 || (previous && (previous.maximumSubtotal === null || previous.maximumSubtotal > tier.minimumSubtotal || (input.continuityMode === "continuous" && previous.maximumSubtotal !== tier.minimumSubtotal))))
            return disabledTierProgress(input);
        ids[tier.publicId] = true;
    }
    let currentIndex = -1;
    for (let matchIndex = 0; matchIndex < tiers.length; matchIndex += 1) {
        const candidate = tiers[matchIndex];
        const candidateMaximum = candidate.maximumSubtotal;
        if (subtotal >= candidate.minimumSubtotal && (candidateMaximum === null || subtotal < candidateMaximum))
            currentIndex = matchIndex;
    }
    const nextIndex = tiers.findIndex(function (tier) { return tier.minimumSubtotal > subtotal; });
    const highestReached = currentIndex === tiers.length - 1;
    tiers = tiers.map(function (tier, tierIndex) { return Object.assign({}, tier, { isUnlocked: tierIndex <= currentIndex, isCurrent: tierIndex === currentIndex, isNext: tierIndex === nextIndex }); });
    const current = currentIndex >= 0 ? tiers[currentIndex] : null;
    const next = nextIndex >= 0 ? tiers[nextIndex] : null;
    const amount = next ? Math.max(0, next.minimumSubtotal - subtotal) : null;
    const start = current ? current.minimumSubtotal : 0;
    const end = next ? next.minimumSubtotal : start;
    const percent = highestReached ? 100 : end > start ? Math.max(0, Math.min(100, (subtotal - start) / (end - start) * 100)) : 0;
    const percentage = current ? current.percentage : next ? next.percentage : 0;
    const nextPercentage = next ? next.percentage : 0;
    const state = highestReached ? "HIGHEST_TIER_UNLOCKED" : current ? "TIER_UNLOCKED" : "BELOW_FIRST_TIER";
    return { enabled: true, promotionPublicId: input.promotionPublicId || null, currencyCode: input.currencyCode, qualifyingSubtotal: subtotal, currentTier: current, nextTier: next, highestTier: tiers[tiers.length - 1], amountToNextTier: amount, progressPercent: Math.round(percent), tiers: tiers, state: state, message: { eyebrow: "Add more, unlock more savings!", title: state === "HIGHEST_TIER_UNLOCKED" ? "Congratulations! You've unlocked " + percentage + "% OFF!" : current ? "You've unlocked " + percentage + "% OFF!" : "", description: state === "HIGHEST_TIER_UNLOCKED" ? "You are getting the highest discount tier." : "Add {amount} more to unlock " + nextPercentage + "% OFF." } };
}
if (typeof window !== "undefined")
    window.LoopDeskTierProgress = { buildTierProgressViewModel: buildTierProgressViewModel };
