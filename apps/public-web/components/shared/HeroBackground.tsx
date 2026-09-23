import Image from 'next/image'

/** Decorative background; the parent supplies relative positioning and isolation. */
export function HeroBackground({ priority = false }: { priority?: boolean }) {
  return <>
    <Image src="/brand/patient-hero-grid.jpg" alt="" fill priority={priority} className="-z-20 object-cover object-center opacity-55" />
    <div aria-hidden="true" className="absolute inset-0 -z-10 bg-black/80" />
  </>
}
