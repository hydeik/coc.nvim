import Document from '../model/document'
import workspace from '../workspace'
import { Color, ColorInformation, Disposable, Range } from 'vscode-languageserver-protocol'
import { equals } from '../util/object'
import { Neovim } from '@chemzqm/neovim'
import { group } from '../util/array'
import { wait } from '../util'

export interface ColorRanges {
  color: Color
  ranges: Range[]
}

const usedColors: Set<string> = new Set()

export default class Highlighter implements Disposable {
  private matchIds: number[] = []
  private _colors: ColorInformation[] = []
  // last highlight version
  private _version: number
  constructor(
    private nvim: Neovim,
    private document: Document,
    private srcId = 0) {
  }

  public get version(): number {
    return this._version
  }

  public get colors(): ColorInformation[] {
    return this._colors
  }

  public hasColor(): boolean {
    return this._colors.length > 0
  }

  public async highlight(colors: ColorInformation[]): Promise<void> {
    colors = colors || []
    this._version = this.document.version
    this.clearHighlight()
    if (colors.length) {
      this._colors = colors
      let groups = group(colors, 100)
      for (let colors of groups) {
        this.nvim.pauseNotification()
        let colorRanges = this.getColorRanges(colors)
        this.addColors(colors.map(o => o.color))
        for (let o of colorRanges) {
          await this.addHighlight(o.ranges, o.color)
        }
        this.nvim.resumeNotification()
        await wait(50)
      }
    }
  }

  private async addHighlight(ranges: Range[], color: Color): Promise<void> {
    let { red, green, blue } = toHexColor(color)
    let hlGroup = `BG${toHexString(color)}`
    let ids = await this.document.highlightRanges(ranges, hlGroup, this.srcId)
    if (workspace.isVim) this.matchIds.push(...ids)
  }

  private addColors(colors: Color[]): void {
    let commands: string[] = []
    for (let color of colors) {
      let hex = toHexString(color)
      if (!usedColors.has(hex)) {
        commands.push(`hi BG${hex} guibg=#${hex} guifg=#${isDark(color) ? 'ffffff' : '000000'}`)
        usedColors.add(hex)
      }
    }
    this.nvim.command(commands.join('|'), true)
  }

  public clearHighlight(): void {
    let { matchIds, srcId } = this
    if (!this.document) return
    if (workspace.isVim) {
      this.matchIds = []
      this.document.clearMatchIds(matchIds)
    } else {
      this.document.clearMatchIds([srcId])
    }
    this._colors = []
  }

  private getColorRanges(infos: ColorInformation[]): ColorRanges[] {
    let res: ColorRanges[] = []
    for (let info of infos) {
      let { color, range } = info
      let idx = res.findIndex(o => {
        return equals(toHexColor(o.color), toHexColor(color))
      })
      if (idx == -1) {
        res.push({
          color,
          ranges: [range]
        })
      } else {
        let r = res[idx]
        r.ranges.push(range)
      }
    }
    return res
  }

  public dispose(): void {
    this.nvim.resumeNotification()
    this.document = null
  }
}

export function toHexString(color: Color): string {
  let c = toHexColor(color)
  return `${pad(c.red.toString(16))}${pad(c.green.toString(16))}${pad(c.blue.toString(16))}`
}

function pad(str: string): string {
  return str.length == 1 ? `0${str}` : str
}

function toHexColor(color: Color): { red: number, green: number, blue: number } {
  let { red, green, blue } = color
  return {
    red: Math.round(red * 255),
    green: Math.round(green * 255),
    blue: Math.round(blue * 255)
  }
}

function isDark(color: Color): boolean {
  let { red, green, blue } = toHexColor(color)
  let luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue
  return luma < 40
}
