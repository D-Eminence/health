'use client'

import Image from 'next/image'
import { Wrap } from '@hid/ui'
import { TRUST } from '@/content/site'

const PARTNERS = [
  { name: 'Kolekto', src: '/brand/partner-kolekto.png', width: 126, height: 30 },
  { name: 'Ilorin Innovation Hub', src: '/brand/partner-iih.png', width: 140, height: 40 },
  { name: 'iDICE Startup Bridge', src: '/brand/partner-idice.png', width: 132, height: 34 },
  { name: 'Amazon Web Services', src: '/brand/partner-aws.png', width: 100, height: 32 },
] as const

// Two matching halves keep the motion seamless. Only the first four marks are
// exposed to assistive technology or shown when motion is reduced.
const PARTNER_TRACK = [...PARTNERS, ...PARTNERS, ...PARTNERS, ...PARTNERS, ...PARTNERS, ...PARTNERS, ...PARTNERS, ...PARTNERS] as const

/**
 * The approved partner marks. The repeated track creates a continuous marquee;
 * reduced-motion visitors receive the same logos as a static row.
 */
export function TrustStrip() {
  return (
    <section aria-label="Partners" className="border-y border-line bg-white py-10 sm:py-12">
      <Wrap>
        <p className="mb-7 text-center font-mono text-[11px] tracking-[0.14em] text-faint uppercase">{TRUST.label}</p>
        <div
          className="partner-marquee"
          role="region"
          tabIndex={0}
          aria-label="Partner logos. Movement pauses while this area has focus."
        >
          <div className="partner-marquee-track">
            {PARTNER_TRACK.map((partner, index) => (
              <PartnerLogo
                key={`${partner.name}-${index}`}
                partner={partner}
                hidden={index >= PARTNERS.length}
                duplicate={index >= PARTNERS.length}
              />
            ))}
          </div>
        </div>
      </Wrap>
    </section>
  )
}

function PartnerLogo({
  partner,
  hidden = false,
  duplicate = false,
}: {
  partner: (typeof PARTNERS)[number]
  hidden?: boolean
  duplicate?: boolean
}) {
  return (
    <span
      aria-hidden={hidden || undefined}
      data-marquee-copy={duplicate || undefined}
      className="partner-marquee-logo"
    >
      <Image
        src={partner.src}
        alt={hidden ? '' : partner.name}
        width={partner.width}
        height={partner.height}
        className="h-auto w-auto max-h-10 object-contain opacity-75 grayscale transition-opacity duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:opacity-100 motion-reduce:transition-none"
      />
    </span>
  )
}
