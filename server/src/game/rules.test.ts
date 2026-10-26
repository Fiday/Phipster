import test from "node:test";
import assert from "node:assert/strict";
import { artistGuessMatches, findAutomaticSlot, guessMatches, isValidPlacement, songAndArtistGuessMatches } from "./rules.js";
import type { TimelineCard } from "../types/protocol.js";

const card = (year: number, id = String(year)): TimelineCard => ({ songId: id, title: id, artist: "Test", year });

test("accepts a year between neighbors", () => {
  assert.equal(isValidPlacement(2001, [card(1997), card(2005)], 1), true);
});

test("rejects a year outside the chosen neighbors", () => {
  assert.equal(isValidPlacement(1990, [card(1997), card(2005)], 1), false);
});

test("accepts same-year placement on either side", () => {
  const timeline = [card(2001, "a")];
  assert.equal(isValidPlacement(2001, timeline, 0), true);
  assert.equal(isValidPlacement(2001, timeline, 1), true);
});

test("rejects invalid slots", () => {
  assert.equal(isValidPlacement(2001, [card(1997)], -1), false);
  assert.equal(isValidPlacement(2001, [card(1997)], 2), false);
});

test("automatic insertion keeps the timeline sorted and places after equal years", () => {
  assert.equal(findAutomaticSlot(2001, [card(1997), card(2001, "a"), card(2001, "b"), card(2005)]), 3);
  assert.equal(findAutomaticSlot(1990, [card(1997), card(2005)]), 0);
  assert.equal(findAutomaticSlot(2010, [card(1997), card(2005)]), 2);
});

test("song guesses ignore casing, punctuation, accents and common version suffixes", () => {
  assert.equal(guessMatches("Beyonce", "Beyoncé"), true);
  assert.equal(guessMatches("The Scientist", "Scientist"), true);
  assert.equal(guessMatches("Song Name", "Song Name (2011 Remaster)"), true);
  assert.equal(songAndArtistGuessMatches("Song Name", "The Artist", "Song Name (Radio Edit)", "Artist"), true);
});


test("song guesses allow small spelling mistakes but reject vague partial answers", () => {
  assert.equal(guessMatches("Bohemain Rhapsody", "Bohemian Rhapsody"), true);
  assert.equal(guessMatches("Californa Dreamin", "California Dreamin'"), true);
  assert.equal(guessMatches("Hotel", "Hotel California"), false);
  assert.equal(guessMatches("zzzzzz", "Beatles"), false);
});

test("artist guesses accept the first credited artist on collaborations", () => {
  assert.equal(artistGuessMatches("Queen", "Queen, David Bowie"), true);
  assert.equal(artistGuessMatches("Quen", "Queen, David Bowie"), true);
  assert.equal(songAndArtistGuessMatches("Under Presure", "Queen", "Under Pressure", "Queen, David Bowie"), true);
  assert.equal(artistGuessMatches("Earth", "Earth, Wind & Fire"), false);
  assert.equal(artistGuessMatches("Tyler", "Tyler, The Creator"), false);
});
