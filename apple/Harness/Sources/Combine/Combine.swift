// A STUB. This is not Combine.
//
// It is this project's *belief* about the two Combine symbols that
// `apple/Sources/Browser` uses, written from memory on a machine with no iOS
// SDK. A green build proves the browser's Swift agrees with the surface
// described here; it proves nothing about whether that surface is Apple's.
//
// This target exists at all because `ObservableObject` and `@Published` are
// Combine's, not SwiftUI's — a file that declares an `ObservableObject` and
// imports only Foundation does not compile on iOS either. SwiftUI re-exports
// Combine, which is why the mistake is easy to make and easy to miss.

import Foundation

public protocol ObservableObject: AnyObject {}

/// The real `@Published` is restricted to class instances through a static
/// subscript on the enclosing type. That restriction is not modelled here; this
/// stub is looser than Combine, which is safe in one direction only — code that
/// compiles on iOS compiles here, but not necessarily the other way round.
@propertyWrapper
public struct Published<Value> {
    public var wrappedValue: Value

    public init(wrappedValue: Value) {
        self.wrappedValue = wrappedValue
    }
}
