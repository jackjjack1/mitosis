import AppKit

let outputPath = CommandLine.arguments.count > 1
    ? CommandLine.arguments[1]
    : "icon-1024.png"
let pixels = 1024
let canvas = CGFloat(pixels)

guard
    let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: pixels,
        pixelsHigh: pixels,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    )
else {
    fputs("Could not allocate icon bitmap\n", stderr)
    exit(1)
}
bitmap.size = NSSize(width: canvas, height: canvas)

NSGraphicsContext.saveGraphicsState()
guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
    fputs("Could not create icon context\n", stderr)
    exit(1)
}
NSGraphicsContext.current = context
context.imageInterpolation = .high

let margin: CGFloat = 58
let tile = NSRect(
    x: margin,
    y: margin,
    width: canvas - margin * 2,
    height: canvas - margin * 2
)
let tilePath = NSBezierPath(roundedRect: tile, xRadius: 208, yRadius: 208)
let background = NSGradient(colors: [
    NSColor(calibratedRed: 0.035, green: 0.055, blue: 0.033, alpha: 1),
    NSColor(calibratedRed: 0.075, green: 0.125, blue: 0.063, alpha: 1)
])!
background.draw(in: tilePath, angle: -62)

NSGraphicsContext.saveGraphicsState()
tilePath.addClip()
NSColor(calibratedRed: 0.78, green: 1, blue: 0.29, alpha: 0.05).setStroke()
let grid = NSBezierPath()
grid.lineWidth = 1.5
for value in stride(from: 0, through: pixels, by: 64) {
    let position = CGFloat(value)
    grid.move(to: NSPoint(x: position, y: 0))
    grid.line(to: NSPoint(x: position, y: canvas))
    grid.move(to: NSPoint(x: 0, y: position))
    grid.line(to: NSPoint(x: canvas, y: position))
}
grid.stroke()
NSGraphicsContext.restoreGraphicsState()

NSColor(calibratedRed: 0.78, green: 1, blue: 0.29, alpha: 0.16).setStroke()
let orbit = NSBezierPath(ovalIn: NSRect(x: 165, y: 165, width: 694, height: 694))
orbit.lineWidth = 3
orbit.stroke()

NSColor(calibratedRed: 0.47, green: 0.89, blue: 0.75, alpha: 0.12).setStroke()
let orbitInner = NSBezierPath(ovalIn: NSRect(x: 225, y: 225, width: 574, height: 574))
orbitInner.lineWidth = 1.5
orbitInner.stroke()

let shadow = NSShadow()
shadow.shadowColor = NSColor(calibratedRed: 0.78, green: 1, blue: 0.29, alpha: 0.4)
shadow.shadowBlurRadius = 54
shadow.shadowOffset = .zero
shadow.set()

let cellGradient = NSGradient(colors: [
    NSColor(calibratedRed: 0.95, green: 1, blue: 0.78, alpha: 1),
    NSColor(calibratedRed: 0.78, green: 1, blue: 0.29, alpha: 1),
    NSColor(calibratedRed: 0.35, green: 0.55, blue: 0.11, alpha: 1)
])!
let leftCell = NSBezierPath(ovalIn: NSRect(x: 232, y: 344, width: 354, height: 354))
cellGradient.draw(in: leftCell, relativeCenterPosition: NSPoint(x: -0.34, y: 0.32))

NSShadow().set()

NSColor(calibratedRed: 0.47, green: 0.89, blue: 0.75, alpha: 0.82).setStroke()
let rightCell = NSBezierPath(ovalIn: NSRect(x: 448, y: 306, width: 372, height: 372))
rightCell.lineWidth = 34
rightCell.stroke()

NSColor(calibratedRed: 0.78, green: 1, blue: 0.29, alpha: 0.9).setFill()
NSBezierPath(ovalIn: NSRect(x: 764, y: 268, width: 42, height: 42)).fill()

NSColor(calibratedRed: 0.47, green: 0.89, blue: 0.75, alpha: 0.65).setFill()
NSBezierPath(ovalIn: NSRect(x: 806, y: 424, width: 17, height: 17)).fill()

NSGraphicsContext.restoreGraphicsState()

guard let png = bitmap.representation(using: .png, properties: [:]) else {
    fputs("Could not encode icon\n", stderr)
    exit(1)
}
do {
    try png.write(to: URL(fileURLWithPath: outputPath))
} catch {
    fputs("Could not write icon: \(error.localizedDescription)\n", stderr)
    exit(1)
}
