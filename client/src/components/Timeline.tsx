import type { PublicChallenge, TimelineCard } from "../types";

export function Timeline({ cards, compact = false }: { cards: TimelineCard[]; compact?: boolean }) {
  return (
    <div className={`timeline ${compact ? "timeline--compact" : ""}`}>
      {cards.map((card) => (
        <div className="timeline-card" key={card.songId} title={`${card.artist} — ${card.title}`}>
          <strong>{card.year}</strong>
          {!compact && <><span>{card.title}</span><small>{card.artist}</small></>}
        </div>
      ))}
    </div>
  );
}

export function TokenCount({ count, compact = false }: { count: number; compact?: boolean }) {
  return (
    <span className={`token-count ${compact ? "token-count--compact" : ""}`} title={`${count} phipster token${count === 1 ? "" : "s"}`}>
      <span className="token-dot">F</span>
      <strong>{count}</strong>
    </span>
  );
}

export function LiveTimeline({
  cards,
  previewSlot,
  locked = false,
  challenges = [],
}: {
  cards: TimelineCard[];
  previewSlot: number | null;
  locked?: boolean;
  challenges?: PublicChallenge[];
}) {
  return (
    <div className="live-timeline-wrap">
      <div className="live-timeline">
        {Array.from({ length: cards.length + 1 }, (_, slot) => {
          const challenge = challenges.find((item) => item.slot === slot);
          const isPreview = previewSlot === slot;
          return (
            <div className="live-timeline-segment" key={slot}>
              <div className={`live-gap ${isPreview ? "live-gap--preview" : ""} ${locked && isPreview ? "live-gap--locked" : ""} ${challenge ? "live-gap--challenge" : ""}`}>
                {isPreview && (
                  <div className="ghost-card">
                    <strong>{locked ? "LOCKED" : "?"}</strong>
                    <small>{locked ? "placement" : "thinking here"}</small>
                  </div>
                )}
                {challenge && (
                  <div className="challenge-marker" title={`${challenge.challengerName} called phipster here`}>
                    <span>F</span>
                    <small>{challenge.challengerName}</small>
                  </div>
                )}
              </div>
              {slot < cards.length && (
                <div className="timeline-card timeline-card--live" title={`${cards[slot].artist} — ${cards[slot].title}`}>
                  <strong>{cards[slot].year}</strong>
                  <span>{cards[slot].title}</span>
                  <small>{cards[slot].artist}</small>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PlacementTimeline({
  cards,
  selectedSlot,
  onSelect,
  disabled,
  lockedSlot = null,
  challenges = [],
  challengeMode = false,
}: {
  cards: TimelineCard[];
  selectedSlot: number | null;
  onSelect: (slot: number) => void;
  disabled?: boolean;
  lockedSlot?: number | null;
  challenges?: PublicChallenge[];
  challengeMode?: boolean;
}) {
  return (
    <div className="placement-scroll">
      <div className="placement-timeline">
        {Array.from({ length: cards.length + 1 }, (_, slot) => {
          const claim = challenges.find((challenge) => challenge.slot === slot);
          const isLockedPlacement = lockedSlot === slot;
          const unavailable = Boolean(disabled || claim || (challengeMode && isLockedPlacement));
          return (
            <div className="placement-segment" key={slot}>
              <button
                className={`slot ${selectedSlot === slot ? "slot--selected" : ""} ${isLockedPlacement ? "slot--locked" : ""} ${claim ? "slot--claimed" : ""}`}
                onClick={() => onSelect(slot)}
                disabled={unavailable}
                aria-label={claim ? `${claim.challengerName} claimed position ${slot + 1}` : `Place token in position ${slot + 1}`}
                title={claim ? `${claim.challengerName} already called phipster here` : undefined}
              >
                {claim ? "PH" : isLockedPlacement ? "🔒" : "+"}
              </button>
              {slot < cards.length && (
                <div className="timeline-card timeline-card--phone">
                  <strong>{cards[slot].year}</strong>
                  <span>{cards[slot].title}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
