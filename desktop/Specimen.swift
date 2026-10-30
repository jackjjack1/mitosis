import Foundation

struct SpecimenFile {
    let url: URL
    let displayName: String
}

enum SpecimenFileError: LocalizedError {
    case folder(String)

    var errorDescription: String? {
        switch self {
        case .folder(let name):
            return "“\(name)” is a folder, not a file. Compress it to a ZIP and drop the ZIP, or choose a file inside it."
        }
    }
}

func specimenFile(at url: URL) throws -> SpecimenFile {
    let values = try url.resourceValues(forKeys: [.isDirectoryKey])
    guard values.isDirectory == true else {
        return SpecimenFile(url: url, displayName: url.lastPathComponent)
    }

    if
        let bundle = Bundle(url: url),
        let executable = bundle.executableURL,
        FileManager.default.isExecutableFile(atPath: executable.path)
    {
        return SpecimenFile(url: executable, displayName: url.lastPathComponent)
    }

    throw SpecimenFileError.folder(url.lastPathComponent)
}
