/**
 * The photos on salons' pages, one per kind of treatment. The same for every
 * salon: they show what a treatment is, never claim to be the salon's own
 * work, and are captioned that way wherever they could be read as a portfolio.
 *
 * From Unsplash, under the Unsplash licence (free for commercial use, no
 * credit required).
 */

import type { StaticImageData } from "next/image";
import type { TileArt } from "@/lib/online-booking/salon-page";
import acrylic from "./photos/acrylic.jpg";
import artBright from "./photos/art-bright.jpg";
import art from "./photos/art.jpg";
import biab from "./photos/biab.jpg";
import gel from "./photos/gel.jpg";
import pedicure from "./photos/pedicure.jpg";
import technician from "./photos/technician.jpg";

export interface Photo {
  src: StaticImageData;
  alt: string;
}

export const PHOTOS: Record<TileArt, Photo> = {
  gel: { src: gel, alt: "A hand on a cream knit jumper, nails in lilac-grey gel with one white and one glitter accent nail" },
  biab: { src: biab, alt: "Two hands with natural-looking nude almond nails" },
  acrylic: { src: acrylic, alt: "Long almond nails alternating glossy black and tortoiseshell" },
  art: { src: art, alt: "Raspberry almond nails with 'love' hand-lettered across two of them" },
  pedicure: { src: pedicure, alt: "Feet resting in a pedicure bowl scattered with orchid flowers" },
  other: { src: technician, alt: "A nail technician carefully tidying a client's cuticles" },
};

/** The hero's photo. */
export const HERO_PHOTO = PHOTOS.gel;

/** The "Bring a picture" strip: ideas to bring along, not the salon's work. */
export const IDEA_PHOTOS: Photo[] = [
  PHOTOS.acrylic,
  PHOTOS.art,
  { src: artBright, alt: "Hands together showing abstract nail art in yellow, red, blue and black" },
  PHOTOS.biab,
];
