import Image from "next/image";

/** Official launch widget. Keep its dimensions stable while the badge loads. */
export function ProductHuntBadge() {
  return <a
    href="https://www.producthunt.com/products/keryx-2?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-keryx-2"
    target="_blank"
    rel="noopener noreferrer"
    aria-label="Keryx on Product Hunt (opens in a new tab)"
    className="inline-flex rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-seal"
  >
    <Image
      src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1273402&theme=light&t=1791462700300"
      alt="Keryx — AI research with verifiable sources and creator rewards | Product Hunt"
      width={250}
      height={54}
      unoptimized
      referrerPolicy="no-referrer"
      className="h-[54px] w-[250px] max-w-full"
    />
  </a>;
}
