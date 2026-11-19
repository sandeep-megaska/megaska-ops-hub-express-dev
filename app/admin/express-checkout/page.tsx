import { redirect } from 'next/navigation'

// Moved to /admin/checkout ("Prepaid offer & COD"). Kept so old links still work.
export default async function ExpressCheckoutRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item)
  }
  const query = params.toString()
  redirect(query ? `/admin/checkout?${query}` : '/admin/checkout')
}
