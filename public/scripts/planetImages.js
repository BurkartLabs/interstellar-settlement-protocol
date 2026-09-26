// Every Sol planet and moon has a NASA image (AB#741): public domain, each source and credit in
// public/images/planets/CREDITS.md, cropped square around the disc at 512 px and under 150 KB. The asteroid belt has
// none on purpose: it is drawn as a field of asteroids (drawAsteroidBelt), never as a disc. A module of its own so the
// Station's header (stationArt.js, ISP-78) reads it without loading the Starmap.
export const PLANET_IMAGE_PATHS = {
  mercury: "/images/planets/mercury.jpg",
  venus: "/images/planets/venus.jpg",
  earth: "/images/planets/earth.jpg",
  mars: "/images/planets/mars.jpg",
  jupiter: "/images/planets/jupiter.jpg",
  saturn: "/images/planets/saturn.jpg",
  uranus: "/images/planets/uranus.jpg",
  neptune: "/images/planets/neptune.jpg",
  luna: "/images/planets/luna.jpg",
  phobos: "/images/planets/phobos.jpg",
  deimos: "/images/planets/deimos.jpg",
  io: "/images/planets/io.jpg",
  europa: "/images/planets/europa.jpg",
  ganymede: "/images/planets/ganymede.jpg",
  callisto: "/images/planets/callisto.jpg",
  titan: "/images/planets/titan.jpg",
  enceladus: "/images/planets/enceladus.jpg"
};
