import { EhrPrintHeader, type EhrPrintHeaderProps } from '@hid/ui/ehr'
import '@hid/ui/ehr.css'
import { BrandLogo } from '../../BrandLogo'

/**
 * The one header on everything this website prints (owner, 23 Nov 2026): the Health ID logo, as the sidebar draws it,
 * and the name of the facility the paper is printed at. Nothing else: no web address, no Health ID, no patient detail.
 */
export function PrintHeader(props: Omit<EhrPrintHeaderProps, 'logo'>) {
  return <EhrPrintHeader logo={<BrandLogo className="hid-ehr-print-header-mark" />} {...props} />
}
