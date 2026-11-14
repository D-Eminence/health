import logo from '../../public-web/public/brand/logo.png'

/** Use the same supplied lockup as the public site in the portal's Vite bundle. */
export function BrandLogo({ className }: { readonly className?: string }) {
  return <img className={className} src={logo} alt="Health ID" width={890} height={264} />
}
