import Foundation

// One request per process. No renderer-supplied operation or path reaches this helper
// until the Electron repository has validated the vault path.
let input = FileHandle.standardInput.readDataToEndOfFile()
var output: [String: Any] = [:]
do {
    guard let request = try JSONSerialization.jsonObject(with: input) as? [String: Any],
          let path = request["path"] as? String, let operation = request["op"] as? String else {
        throw NSError(domain: "MindNB", code: 1, userInfo: [NSLocalizedDescriptionKey: "无效文件请求"])
    }
    let url = URL(fileURLWithPath: path)
    let coordinator = NSFileCoordinator(filePresenter: nil)
    var coordinationError: NSError?
    var operationError: Error?
    if operation == "write" {
        coordinator.coordinate(writingItemAt: url, options: .forReplacing, error: &coordinationError) { target in
            do {
                if let expected = request["expected"] {
                    let current = FileManager.default.fileExists(atPath: target.path) ? try Data(contentsOf: target) : nil
                    let matches = expected is NSNull ? current == nil : current == Data(base64Encoded: expected as? String ?? "")
                    if !matches { throw NSError(domain: "MindNB", code: 2, userInfo: [NSLocalizedDescriptionKey: "文件已被外部修改，请重试"]) }
                }
                guard let encoded = request["data"] as? String, let data = Data(base64Encoded: encoded) else {
                    throw NSError(domain: "MindNB", code: 3, userInfo: [NSLocalizedDescriptionKey: "无效写入内容"])
                }
                try data.write(to: target, options: .atomic)
                let file = try FileHandle(forWritingTo: target)
                try file.synchronize()
                try file.close()
                output["ok"] = true
            } catch { operationError = error }
        }
    } else {
        coordinator.coordinate(readingItemAt: url, options: [], error: &coordinationError) { target in
            do {
                if operation == "read" {
                    let data = try Data(contentsOf: target)
                    if data.count > 32 * 1024 * 1024 { throw NSError(domain: "MindNB", code: 4, userInfo: [NSLocalizedDescriptionKey: "文件过大"]) }
                    output["data"] = data.base64EncodedString()
                } else if operation == "versions" {
                    var versions: [String] = []
                    var totalBytes = 0
                    for version in (NSFileVersion.unresolvedConflictVersionsOfItem(at: target) ?? []) {
                        let data = try Data(contentsOf: version.url)
                        totalBytes += data.count
                        if data.count > 32 * 1024 * 1024 || totalBytes > 256 * 1024 * 1024 {
                            throw NSError(domain: "MindNB", code: 6, userInfo: [NSLocalizedDescriptionKey: "系统冲突版本过大，已保留原文件"])
                        }
                        versions.append(data.base64EncodedString())
                    }
                    output["versions"] = versions
                } else { throw NSError(domain: "MindNB", code: 5, userInfo: [NSLocalizedDescriptionKey: "不支持的操作"]) }
            } catch { operationError = error }
        }
    }
    if let error = coordinationError { throw error }
    if let error = operationError { throw error }
} catch { output = ["error": error.localizedDescription] }
let encoded = try! JSONSerialization.data(withJSONObject: output, options: [.sortedKeys])
FileHandle.standardOutput.write(encoded)
