import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '永续合约数据仪表盘',
  description: 'Binance 和 Bybit 永续合约数据监控',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}

