import React from 'react'

type P = React.SVGProps<SVGSVGElement> & { size?: number }
const svg = (path: React.ReactNode, defSize = 18) => (props: P) => {
  const { size, ...rest } = props
  return (
    <svg width={size || defSize} height={size || defSize} viewBox='0 0 24 24'
      fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'
      {...rest}>
      {path}
    </svg>
  )
}

export const IconHome = svg(<><path d='M3 10.5 12 3l9 7.5' /><path d='M5 9.5V21h14V9.5' /></>)
export const IconGrid = svg(<><rect x='3' y='3' width='7' height='7' rx='1' /><rect x='14' y='3' width='7' height='7' rx='1' /><rect x='3' y='14' width='7' height='7' rx='1' /><rect x='14' y='14' width='7' height='7' rx='1' /></>)
export const IconList = svg(<><line x1='8' y1='6' x2='21' y2='6' /><line x1='8' y1='12' x2='21' y2='12' /><line x1='8' y1='18' x2='21' y2='18' /><line x1='3' y1='6' x2='3.01' y2='6' /><line x1='3' y1='12' x2='3.01' y2='12' /><line x1='3' y1='18' x2='3.01' y2='18' /></>)
export const IconSearch = svg(<><circle cx='11' cy='11' r='7' /><line x1='21' y1='21' x2='16.65' y2='16.65' /></>)
export const IconSettings = svg(<><circle cx='12' cy='12' r='3' /><path d='M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' /></>)
export const IconBookmark = svg(<><path d='M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z' /></>)
export const IconStar = svg(<polygon points='12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2' />)
export const IconPlay = svg(<polygon points='6 4 20 12 6 20 6 4' fill='currentColor' stroke='none' />)
export const IconPause = svg(<><rect x='6' y='4' width='4' height='16' rx='1' fill='currentColor' stroke='none' /><rect x='14' y='4' width='4' height='16' rx='1' fill='currentColor' stroke='none' /></>)
export const IconPrev = svg(<polyline points='15 18 9 12 15 6' />)
export const IconNext = svg(<polyline points='9 18 15 12 9 6' />)
export const IconClose = svg(<><line x1='18' y1='6' x2='6' y2='18' /><line x1='6' y1='6' x2='18' y2='18' /></>)
export const IconPlus = svg(<><line x1='12' y1='5' x2='12' y2='19' /><line x1='5' y1='12' x2='19' y2='12' /></>)
export const IconTrash = svg(<><polyline points='3 6 5 6 21 6' /><path d='M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' /></>)
export const IconBack = svg(<line x1='19' y1='12' x2='5' y2='12' />)
export const IconSpeaker = svg(<><polygon points='11 5 6 9 2 9 2 15 6 15 11 19 11 5' fill='currentColor' stroke='none' /><path d='M15.5 8.5a5 5 0 0 1 0 7' /><path d='M19 5a9 9 0 0 1 0 14' /></>)
export const IconToc = svg(<><line x1='3' y1='6' x2='21' y2='6' /><line x1='3' y1='12' x2='21' y2='12' /><line x1='3' y1='18' x2='21' y2='18' /></>)
export const IconMin = svg(<line x1='5' y1='12' x2='19' y2='12' />)
export const IconMax = svg(<rect x='5' y='5' width='14' height='14' rx='1' />)
export const IconSquare = svg(<rect x='6' y='6' width='12' height='12' rx='1' fill='currentColor' stroke='none' />)
