// A STUB. This is not SwiftUI.
//
// It is this project's *belief* about the parts of SwiftUI that
// `apple/Sources/Browser` uses, written from memory on a machine with no iOS
// SDK. Compiling against it proves the browser's Swift is internally consistent
// and agrees with the surface described here. It proves nothing about whether
// that surface is Apple's — a wrong belief compiles perfectly and then fails on
// a Mac.
//
// Every declaration below is therefore a claim to check against Xcode's
// autocomplete. Keep it minimal: an unused stub is an unchecked claim.

@_exported import Foundation
// SwiftUI re-exports Combine on Apple platforms, which is why `import SwiftUI`
// is enough to get ObservableObject there. Modelled faithfully.
@_exported import Combine
import UIKit

// MARK: - View

@MainActor
public protocol View {
    associatedtype Body: View
    @ViewBuilder var body: Self.Body { get }
}

extension Never: View {
    public typealias Body = Never
    public var body: Never { fatalError("Never has no body") }
}

extension Optional: View where Wrapped: View {
    public typealias Body = Never
    public var body: Never { fatalError("primitive view") }
}

public struct EmptyView: View {
    public init() {}
    public var body: Never { fatalError("primitive view") }
}

public struct TupleView<T>: View {
    public var value: T
    public init(_ value: T) { self.value = value }
    public var body: Never { fatalError("primitive view") }
}

public struct _ConditionalContent<TrueContent, FalseContent>: View {
    public init() {}
    public var body: Never { fatalError("primitive view") }
}

@MainActor
@resultBuilder
public struct ViewBuilder {
    public static func buildBlock() -> EmptyView {
        return EmptyView()
    }

    public static func buildBlock<C: View>(_ content: C) -> C {
        return content
    }

    public static func buildBlock<C0: View, C1: View>(_ c0: C0, _ c1: C1) -> TupleView<(C0, C1)> {
        return TupleView((c0, c1))
    }

    public static func buildBlock<C0: View, C1: View, C2: View>(
        _ c0: C0, _ c1: C1, _ c2: C2
    ) -> TupleView<(C0, C1, C2)> {
        return TupleView((c0, c1, c2))
    }

    public static func buildOptional<C: View>(_ content: C?) -> C? {
        return content
    }

    public static func buildEither<T: View, F: View>(first: T) -> _ConditionalContent<T, F> {
        return _ConditionalContent<T, F>()
    }

    public static func buildEither<T: View, F: View>(second: F) -> _ConditionalContent<T, F> {
        return _ConditionalContent<T, F>()
    }
}

// MARK: - Layout primitives

public struct HorizontalAlignment {
    public static let center: HorizontalAlignment = HorizontalAlignment()
    public static let leading: HorizontalAlignment = HorizontalAlignment()
    public static let trailing: HorizontalAlignment = HorizontalAlignment()
}

public struct Alignment {
    public static let center: Alignment = Alignment()
    public static let topLeading: Alignment = Alignment()
}

public struct EdgeInsets: Equatable {
    public var top: CGFloat
    public var leading: CGFloat
    public var bottom: CGFloat
    public var trailing: CGFloat

    public init(top: CGFloat, leading: CGFloat, bottom: CGFloat, trailing: CGFloat) {
        self.top = top
        self.leading = leading
        self.bottom = bottom
        self.trailing = trailing
    }
}

public struct VStack<Content: View>: View {
    public init(
        alignment: HorizontalAlignment = .center,
        spacing: CGFloat? = nil,
        @ViewBuilder content: () -> Content
    ) {
        _ = content()
    }
    public var body: Never { fatalError("primitive view") }
}

public struct ZStack<Content: View>: View {
    public init(alignment: Alignment = .center, @ViewBuilder content: () -> Content) {
        _ = content()
    }
    public var body: Never { fatalError("primitive view") }
}

public struct GeometryProxy {
    public var size: CGSize { return CGSize.zero }
    public var safeAreaInsets: EdgeInsets {
        return EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0)
    }
}

public struct GeometryReader<Content: View>: View {
    public init(@ViewBuilder content: @escaping (GeometryProxy) -> Content) {}
    public var body: Never { fatalError("primitive view") }
}

public struct Color: View {
    public init(_ color: UIColor) {}
    public var body: Never { fatalError("primitive view") }
}

// MARK: - Modifiers

public struct _ModifiedView<Content>: View {
    public init() {}
    public var body: Never { fatalError("primitive view") }
}

extension View {
    public func frame(
        width: CGFloat? = nil,
        height: CGFloat? = nil,
        alignment: Alignment = .center
    ) -> some View {
        return _ModifiedView<Self>()
    }

    public func onAppear(perform action: (() -> Void)? = nil) -> some View {
        return _ModifiedView<Self>()
    }

    public func onChange<V: Equatable>(of value: V, perform action: @escaping (V) -> Void) -> some View {
        return _ModifiedView<Self>()
    }

    public func ignoresSafeArea() -> some View {
        return _ModifiedView<Self>()
    }
}

// MARK: - App

@MainActor
public protocol Scene {
    associatedtype Body: Scene
    var body: Self.Body { get }
}

extension Never: Scene {}

@MainActor
public protocol App {
    associatedtype Body: Scene
    init()
    var body: Self.Body { get }
}

extension App {
    public static func main() {}
}

public struct WindowGroup<Content: View>: Scene {
    public init(@ViewBuilder content: @escaping () -> Content) {}
    public var body: Never { fatalError("primitive scene") }
}

// MARK: - Data flow
//
// ObservableObject and @Published live in the Combine stub, re-exported above,
// exactly as SwiftUI re-exports Combine on Apple platforms.

public protocol DynamicProperty {}

@propertyWrapper
public struct StateObject<ObjectType: ObservableObject>: DynamicProperty {
    public var wrappedValue: ObjectType
    public init(wrappedValue thunk: @autoclosure @escaping () -> ObjectType) {
        self.wrappedValue = thunk()
    }
    public var projectedValue: ObjectType { return wrappedValue }
}

@propertyWrapper
public struct ObservedObject<ObjectType: ObservableObject>: DynamicProperty {
    public var wrappedValue: ObjectType
    public init(wrappedValue: ObjectType) { self.wrappedValue = wrappedValue }
}

@propertyWrapper
public struct State<Value>: DynamicProperty {
    public var wrappedValue: Value
    public init(wrappedValue: Value) { self.wrappedValue = wrappedValue }
}

// MARK: - UIKit interop

public struct UIViewRepresentableContext<Representable> {
    public init() {}
}

@MainActor
public protocol UIViewRepresentable: View {
    associatedtype UIViewType: UIView
    typealias Context = UIViewRepresentableContext<Self>

    func makeUIView(context: Self.Context) -> Self.UIViewType
    func updateUIView(_ uiView: Self.UIViewType, context: Self.Context)
}

extension UIViewRepresentable {
    public var body: Never { fatalError("primitive view") }
}
