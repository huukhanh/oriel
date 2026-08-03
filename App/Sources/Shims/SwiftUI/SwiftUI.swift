// A stub of the SwiftUI surface this app uses. Linux only — see App/Package.swift.
//
// EVERY declaration here is an assumption about Apple's API. If one is wrong,
// the app compiles on this box and fails in Xcode. Keep the surface minimal and
// keep signatures conservative: prefer the shape that has been stable for
// several releases over the newest convenience.
import Foundation
import UIKit

// MARK: - View

@MainActor
public protocol View {
    associatedtype Body: View
    @ViewBuilder var body: Body { get }
}

extension View where Body == Never {
    public var body: Never { fatalError("primitive view has no body") }
}

extension Never: View {
    public typealias Body = Never
}

extension Optional: View where Wrapped: View {
    public typealias Body = Never
}

/// Stand-in for any composed/modified view. Real SwiftUI has a zoo of concrete
/// generic types here; for typechecking, one opaque primitive is enough.
public struct _Stub: View {
    public typealias Body = Never
    public init() {}
    public init<T>(_ value: T) { _ = value }
}

public struct AnyView: View {
    public typealias Body = Never
    public init<V: View>(_ view: V) { _ = view }
}

public struct EmptyView: View {
    public typealias Body = Never
    public init() {}
}

public struct TupleView<T>: View {
    public typealias Body = Never
    public init(_ value: T) { _ = value }
}

public struct _Conditional<TrueContent, FalseContent>: View {
    public typealias Body = Never
    public init() {}
}

@MainActor
@resultBuilder
public enum ViewBuilder {
    public static func buildBlock() -> EmptyView { EmptyView() }
    public static func buildBlock<C: View>(_ c: C) -> C { c }
    public static func buildBlock<C0: View, C1: View>(_ c0: C0, _ c1: C1) -> _Stub { _Stub() }
    public static func buildBlock<C0: View, C1: View, C2: View>(
        _ c0: C0, _ c1: C1, _ c2: C2
    ) -> _Stub { _Stub() }
    public static func buildBlock<C0: View, C1: View, C2: View, C3: View>(
        _ c0: C0, _ c1: C1, _ c2: C2, _ c3: C3
    ) -> _Stub { _Stub() }
    public static func buildBlock<C0: View, C1: View, C2: View, C3: View, C4: View>(
        _ c0: C0, _ c1: C1, _ c2: C2, _ c3: C3, _ c4: C4
    ) -> _Stub { _Stub() }
    public static func buildBlock<C0: View, C1: View, C2: View, C3: View, C4: View, C5: View>(
        _ c0: C0, _ c1: C1, _ c2: C2, _ c3: C3, _ c4: C4, _ c5: C5
    ) -> _Stub { _Stub() }
    public static func buildBlock<
        C0: View, C1: View, C2: View, C3: View, C4: View, C5: View, C6: View
    >(
        _ c0: C0, _ c1: C1, _ c2: C2, _ c3: C3, _ c4: C4, _ c5: C5, _ c6: C6
    ) -> _Stub { _Stub() }
    public static func buildBlock<
        C0: View, C1: View, C2: View, C3: View, C4: View, C5: View, C6: View, C7: View
    >(
        _ c0: C0, _ c1: C1, _ c2: C2, _ c3: C3, _ c4: C4, _ c5: C5, _ c6: C6, _ c7: C7
    ) -> _Stub { _Stub() }
    public static func buildBlock<
        C0: View, C1: View, C2: View, C3: View, C4: View, C5: View, C6: View, C7: View, C8: View
    >(
        _ c0: C0, _ c1: C1, _ c2: C2, _ c3: C3, _ c4: C4, _ c5: C5, _ c6: C6, _ c7: C7, _ c8: C8
    ) -> _Stub { _Stub() }
    public static func buildBlock<
        C0: View, C1: View, C2: View, C3: View, C4: View, C5: View, C6: View, C7: View, C8: View,
        C9: View
    >(
        _ c0: C0, _ c1: C1, _ c2: C2, _ c3: C3, _ c4: C4, _ c5: C5, _ c6: C6, _ c7: C7, _ c8: C8,
        _ c9: C9
    ) -> _Stub { _Stub() }

    public static func buildIf<C: View>(_ content: C?) -> C? { content }
    public static func buildOptional<C: View>(_ content: C?) -> C? { content }
    // Both generic parameters must appear in the signature, so this mirrors
    // real SwiftUI's `_ConditionalContent<TrueContent, FalseContent>`.
    public static func buildEither<T: View, F: View>(first: T) -> _Conditional<T, F> {
        _Conditional()
    }
    public static func buildEither<T: View, F: View>(second: F) -> _Conditional<T, F> {
        _Conditional()
    }
    public static func buildLimitedAvailability<C: View>(_ content: C) -> _Stub { _Stub() }
    public static func buildArray<C: View>(_ components: [C]) -> _Stub { _Stub() }
    public static func buildExpression<C: View>(_ expression: C) -> C { expression }
}

// MARK: - Primitives

public struct Text: View {
    public typealias Body = Never
    public init(_ content: String) { _ = content }
    public init(verbatim content: String) { _ = content }
    public init<S: StringProtocol>(_ content: S) { _ = content }
}

public struct Image: View {
    public typealias Body = Never
    public init(systemName: String) { _ = systemName }
    public init(_ name: String) { _ = name }
}

public struct Label<Title, Icon>: View {
    public typealias Body = Never
    public init(
        _ title: String,
        systemImage: String
    ) where Title == Text, Icon == Image {
        _ = title
        _ = systemImage
    }
    public init(
        @ViewBuilder title: () -> Title,
        @ViewBuilder icon: () -> Icon
    ) {
        _ = title()
        _ = icon()
    }
}

public struct Spacer: View {
    public typealias Body = Never
    public init(minLength: CGFloat? = nil) { _ = minLength }
}

public struct Divider: View {
    public typealias Body = Never
    public init() {}
}

public struct Color: View, Hashable, Sendable {
    public typealias Body = Never
    public init(red: Double, green: Double, blue: Double, opacity: Double = 1) {}
    public init(white: Double, opacity: Double = 1) {}
    public static let clear = Color(white: 0, opacity: 0)
    public static let black = Color(white: 0)
    public static let white = Color(white: 1)
    public static let red = Color(white: 0)
    public static let green = Color(white: 0)
    public static let blue = Color(white: 0)
    public static let orange = Color(white: 0)
    public static let yellow = Color(white: 0)
    public static let gray = Color(white: 0)
    public static let secondary = Color(white: 0)
    public static let primary = Color(white: 0)
    public static let accentColor = Color(white: 0)
}

public struct ProgressView: View {
    public typealias Body = Never
    public init() {}
    public init(value: Double?, total: Double = 1.0) {}
}

// MARK: - Layout

public enum Axis: Sendable {
    case horizontal
    case vertical
    public struct Set: OptionSet, Sendable {
        public let rawValue: Int
        public init(rawValue: Int) { self.rawValue = rawValue }
        public static let horizontal = Set(rawValue: 1)
        public static let vertical = Set(rawValue: 2)
    }
}

public struct HorizontalAlignment: Sendable {
    public static let leading = HorizontalAlignment()
    public static let center = HorizontalAlignment()
    public static let trailing = HorizontalAlignment()
}

public struct VerticalAlignment: Sendable {
    public static let top = VerticalAlignment()
    public static let center = VerticalAlignment()
    public static let bottom = VerticalAlignment()
    public static let firstTextBaseline = VerticalAlignment()
}

public struct Alignment: Sendable {
    public static let center = Alignment()
    public static let leading = Alignment()
    public static let trailing = Alignment()
    public static let top = Alignment()
    public static let bottom = Alignment()
    public static let topLeading = Alignment()
}

public struct Edge: Sendable {
    public struct Set: OptionSet, Sendable {
        public let rawValue: Int
        public init(rawValue: Int) { self.rawValue = rawValue }
        public static let top = Set(rawValue: 1)
        public static let bottom = Set(rawValue: 2)
        public static let leading = Set(rawValue: 4)
        public static let trailing = Set(rawValue: 8)
        public static let horizontal: Set = [.leading, .trailing]
        public static let vertical: Set = [.top, .bottom]
        public static let all: Set = [.top, .bottom, .leading, .trailing]
    }
}

public struct VStack<Content: View>: View {
    public typealias Body = Never
    public init(
        alignment: HorizontalAlignment = .center,
        spacing: CGFloat? = nil,
        @ViewBuilder content: () -> Content
    ) { _ = content() }
}

public struct HStack<Content: View>: View {
    public typealias Body = Never
    public init(
        alignment: VerticalAlignment = .center,
        spacing: CGFloat? = nil,
        @ViewBuilder content: () -> Content
    ) { _ = content() }
}

public struct ZStack<Content: View>: View {
    public typealias Body = Never
    public init(
        alignment: Alignment = .center,
        @ViewBuilder content: () -> Content
    ) { _ = content() }
}

public struct LazyVGrid<Content: View>: View {
    public typealias Body = Never
    public init(
        columns: [GridItem],
        alignment: HorizontalAlignment = .center,
        spacing: CGFloat? = nil,
        @ViewBuilder content: () -> Content
    ) { _ = content() }
}

public struct GridItem: Sendable {
    public enum Size: Sendable {
        case fixed(CGFloat)
        case flexible(minimum: CGFloat = 10, maximum: CGFloat = .infinity)
        case adaptive(minimum: CGFloat, maximum: CGFloat = .infinity)
    }
    public init(_ size: Size = .flexible(), spacing: CGFloat? = nil) {}
}

public struct ScrollView<Content: View>: View {
    public typealias Body = Never
    public init(
        _ axes: Axis.Set = .vertical,
        showsIndicators: Bool = true,
        @ViewBuilder content: () -> Content
    ) { _ = content() }
}

public struct Group<Content: View>: View {
    public typealias Body = Never
    public init(@ViewBuilder content: () -> Content) { _ = content() }
}

public struct Form<Content: View>: View {
    public typealias Body = Never
    public init(@ViewBuilder content: () -> Content) { _ = content() }
}

public struct Section<Parent, Content: View, Footer>: View {
    public typealias Body = Never
    public init(
        @ViewBuilder content: () -> Content
    ) where Parent == EmptyView, Footer == EmptyView { _ = content() }
    public init(
        _ title: String,
        @ViewBuilder content: () -> Content
    ) where Parent == Text, Footer == EmptyView { _ = content() }
    public init(
        @ViewBuilder header: () -> Parent,
        @ViewBuilder content: () -> Content
    ) where Footer == EmptyView { _ = content() }
}

public struct List<SelectionValue, Content: View>: View {
    public typealias Body = Never
    public init(
        @ViewBuilder content: () -> Content
    ) where SelectionValue == Never { _ = content() }
    public init(
        selection: Binding<SelectionValue>?,
        @ViewBuilder content: () -> Content
    ) { _ = content() }
}

public struct ForEach<Data: RandomAccessCollection, ID, Content: View>: View {
    public typealias Body = Never
    public init(
        _ data: Data,
        @ViewBuilder content: @escaping (Data.Element) -> Content
    ) where Data.Element: Identifiable, ID == Data.Element.ID {}
    public init(
        _ data: Data,
        id: KeyPath<Data.Element, ID>,
        @ViewBuilder content: @escaping (Data.Element) -> Content
    ) {}
}

// MARK: - Controls

public struct Button<Label: View>: View {
    public typealias Body = Never
    public init(action: @escaping () -> Void, @ViewBuilder label: () -> Label) { _ = label() }
    public init(_ title: String, action: @escaping () -> Void) where Label == Text {}
    public init(
        _ title: String,
        role: ButtonRole?,
        action: @escaping () -> Void
    ) where Label == Text {}
    public init(
        role: ButtonRole?,
        action: @escaping () -> Void,
        @ViewBuilder label: () -> Label
    ) { _ = label() }
}

public struct ButtonRole: Sendable {
    public static let destructive = ButtonRole()
    public static let cancel = ButtonRole()
}

public struct Toggle<Label: View>: View {
    public typealias Body = Never
    public init(isOn: Binding<Bool>, @ViewBuilder label: () -> Label) { _ = label() }
    public init(_ title: String, isOn: Binding<Bool>) where Label == Text {}
}

public struct TextField<Label: View>: View {
    public typealias Body = Never
    public init(_ title: String, text: Binding<String>) where Label == Text {}
    public init(
        _ title: String,
        text: Binding<String>,
        axis: Axis
    ) where Label == Text {}
}

public struct TextEditor: View {
    public typealias Body = Never
    public init(text: Binding<String>) {}
}

public struct Picker<Label: View, SelectionValue: Hashable, Content: View>: View {
    public typealias Body = Never
    public init(
        _ title: String,
        selection: Binding<SelectionValue>,
        @ViewBuilder content: () -> Content
    ) where Label == Text { _ = content() }
}

public struct Stepper<Label: View>: View {
    public typealias Body = Never
    public init(
        _ title: String,
        value: Binding<Int>,
        in range: ClosedRange<Int>,
        step: Int = 1
    ) where Label == Text {}
}

public struct NavigationPath: Sendable {
    public init() {}
}

public struct NavigationStack<Data, Root: View>: View {
    public typealias Body = Never
    public init(
        @ViewBuilder root: () -> Root
    ) where Data == NavigationPath { _ = root() }
    public init(path: Binding<Data>, @ViewBuilder root: () -> Root) { _ = root() }
}

public struct NavigationLink<Label: View, Destination: View>: View {
    public typealias Body = Never
    public init(
        @ViewBuilder destination: () -> Destination,
        @ViewBuilder label: () -> Label
    ) {
        _ = destination()
        _ = label()
    }
    public init(
        _ title: String,
        @ViewBuilder destination: () -> Destination
    ) where Label == Text { _ = destination() }
}

// MARK: - State

/// Class-backed so the setter can be `nonmutating`, exactly as the real
/// `@State` is. Without that, every `self.foo = x` inside a view body fails
/// with "cannot assign to property: 'self' is immutable" — which would be a
/// stub artefact, not a real error, and would push the app towards contortions
/// it does not need.
@propertyWrapper
public struct State<Value> {
    private final class Box {
        var value: Value
        init(_ value: Value) { self.value = value }
    }
    private let box: Box

    public init(wrappedValue: Value) { self.box = Box(wrappedValue) }
    public init(initialValue: Value) { self.box = Box(initialValue) }

    public var wrappedValue: Value {
        get { box.value }
        nonmutating set { box.value = newValue }
    }
    public var projectedValue: Binding<Value> {
        let box = self.box
        return Binding(get: { box.value }, set: { box.value = $0 })
    }
}

@propertyWrapper
public struct Binding<Value> {
    private let getter: () -> Value
    private let setter: (Value) -> Void
    public init(get: @escaping () -> Value, set: @escaping (Value) -> Void) {
        self.getter = get
        self.setter = set
    }
    public var wrappedValue: Value {
        get { getter() }
        nonmutating set { setter(newValue) }
    }
    public var projectedValue: Binding<Value> { self }
    public static func constant(_ value: Value) -> Binding<Value> {
        Binding(get: { value }, set: { _ in })
    }
}

public protocol ObservableObject: AnyObject {}

@propertyWrapper
public struct Published<Value> {
    private final class Box {
        var value: Value
        init(_ value: Value) { self.value = value }
    }
    private let box: Box
    public init(wrappedValue: Value) { self.box = Box(wrappedValue) }
    public init(initialValue: Value) { self.box = Box(initialValue) }
    public var wrappedValue: Value {
        get { box.value }
        nonmutating set { box.value = newValue }
    }
    public var projectedValue: Published<Value> { self }
}

@propertyWrapper
public struct StateObject<ObjectType: ObservableObject> {
    public let wrappedValue: ObjectType
    public init(wrappedValue: @autoclosure @escaping () -> ObjectType) {
        self.wrappedValue = wrappedValue()
    }
    public var projectedValue: ObservedObject<ObjectType>.Wrapper {
        ObservedObject.Wrapper()
    }
}

@propertyWrapper
public struct ObservedObject<ObjectType: ObservableObject> {
    public let wrappedValue: ObjectType
    public init(wrappedValue: ObjectType) { self.wrappedValue = wrappedValue }
    public struct Wrapper {
        public subscript<T>(dynamicMember keyPath: WritableKeyPath<ObjectType, T>) -> Binding<T> {
            fatalError()
        }
    }
    public var projectedValue: Wrapper { Wrapper() }
}

@propertyWrapper
public struct EnvironmentObject<ObjectType: ObservableObject> {
    public var wrappedValue: ObjectType { fatalError("stub") }
    public init() {}
}

@propertyWrapper
public struct Environment<Value> {
    public var wrappedValue: Value { fatalError("stub") }
    public init(_ keyPath: KeyPath<EnvironmentValues, Value>) { _ = keyPath }
}

public struct EnvironmentValues {
    public var scenePhase: ScenePhase = .active
    public var dismiss: DismissAction = DismissAction()
    public var openURL: OpenURLAction = OpenURLAction()
    public var colorScheme: ColorScheme = .light
}

public struct DismissAction {
    public func callAsFunction() {}
}

public struct OpenURLAction {
    public func callAsFunction(_ url: URL) {}
}

public enum ColorScheme: Sendable {
    case light
    case dark
}

public enum ScenePhase: Sendable {
    case active
    case inactive
    case background
}

// MARK: - App

@MainActor
public protocol App {
    associatedtype Body: Scene
    @SceneBuilder var body: Body { get }
    init()
}

extension App {
    public static func main() {}
}

public protocol Scene {
    associatedtype Body: Scene
    @SceneBuilder var body: Body { get }
}

/// Scenes need their own bottom type. Reusing `Never` would make it conform to
/// both `View` and `Scene`, and the two `where Body == Never` defaults then
/// both supply `body` — an ambiguity the compiler rejects.
public struct _NeverScene: Scene {
    public typealias Body = _NeverScene
    public init() {}
    // Returns an instance rather than `fatalError()`: `Never` does not
    // implicitly convert in a single-expression property body.
    public var body: _NeverScene { _NeverScene() }
}

extension Scene where Body == _NeverScene {
    public var body: _NeverScene { _NeverScene() }
}

@resultBuilder
public enum SceneBuilder {
    public static func buildBlock<S: Scene>(_ scene: S) -> S { scene }
}

public struct WindowGroup<Content: View>: Scene {
    public typealias Body = _NeverScene
    public init(@ViewBuilder content: () -> Content) { _ = content() }
}

// MARK: - Modifiers
//
// All return the same opaque stub. Fidelity of the *return type* does not
// matter for catching mistakes in the app's own code; fidelity of the
// *parameters* does, so those mirror the real signatures.

extension View {
    public func padding(_ length: CGFloat) -> some View { _Stub() }
    public func padding(_ edges: Edge.Set = .all, _ length: CGFloat? = nil) -> some View {
        _Stub()
    }
    public func frame(
        width: CGFloat? = nil,
        height: CGFloat? = nil,
        alignment: Alignment = .center
    ) -> some View { _Stub() }
    public func frame(
        minWidth: CGFloat? = nil,
        idealWidth: CGFloat? = nil,
        maxWidth: CGFloat? = nil,
        minHeight: CGFloat? = nil,
        idealHeight: CGFloat? = nil,
        maxHeight: CGFloat? = nil,
        alignment: Alignment = .center
    ) -> some View { _Stub() }
    public func foregroundStyle(_ color: Color) -> some View { _Stub() }
    public func background(_ color: Color) -> some View { _Stub() }
    public func font(_ font: Font?) -> some View { _Stub() }
    public func bold() -> some View { _Stub() }
    public func monospaced() -> some View { _Stub() }
    public func monospacedDigit() -> some View { _Stub() }
    public func lineLimit(_ number: Int?) -> some View { _Stub() }
    public func opacity(_ value: Double) -> some View { _Stub() }
    public func disabled(_ disabled: Bool) -> some View { _Stub() }
    public func hidden() -> some View { _Stub() }
    public func tag<V: Hashable>(_ tag: V) -> some View { _Stub() }
    public func id<V: Hashable>(_ id: V) -> some View { _Stub() }
    public func overlay<V: View>(@ViewBuilder content: () -> V) -> some View { _Stub() }
    public func clipShape<S>(_ shape: S) -> some View { _Stub() }
    public func cornerRadius(_ radius: CGFloat) -> some View { _Stub() }
    public func textSelection(_ selectability: TextSelectability) -> some View { _Stub() }
    public func textFieldStyle<S: TextFieldStyle>(_ style: S) -> some View { _Stub() }
    public func buttonStyle<S: ButtonStyle>(_ style: S) -> some View { _Stub() }
    public func pickerStyle<S: PickerStyle>(_ style: S) -> some View { _Stub() }
    public func listStyle<S: ListStyle>(_ style: S) -> some View { _Stub() }
    public func labelStyle<S>(_ style: S) -> some View { _Stub() }
    public func autocorrectionDisabled(_ disabled: Bool = true) -> some View { _Stub() }
    public func textInputAutocapitalization(_ autocapitalization: TextInputAutocapitalization?)
        -> some View
    { _Stub() }
    public func keyboardType(_ type: UIKeyboardType) -> some View { _Stub() }
    public func submitLabel<S>(_ label: S) -> some View { _Stub() }
    public func navigationTitle(_ title: String) -> some View { _Stub() }
    public func navigationBarTitleDisplayMode(_ mode: NavigationBarItem.TitleDisplayMode)
        -> some View
    { _Stub() }
    public func toolbar<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        _Stub()
    }
    public func sheet<Content: View>(
        isPresented: Binding<Bool>,
        onDismiss: (() -> Void)? = nil,
        @ViewBuilder content: @escaping () -> Content
    ) -> some View { _Stub() }
    public func alert<A: View>(
        _ title: String,
        isPresented: Binding<Bool>,
        @ViewBuilder actions: () -> A
    ) -> some View { _Stub() }
    public func confirmationDialog<A: View>(
        _ title: String,
        isPresented: Binding<Bool>,
        @ViewBuilder actions: () -> A
    ) -> some View { _Stub() }
    public func onAppear(perform action: (() -> Void)? = nil) -> some View { _Stub() }
    public func onDisappear(perform action: (() -> Void)? = nil) -> some View { _Stub() }
    public func onChange<V: Equatable>(
        of value: V,
        _ action: @escaping (V, V) -> Void
    ) -> some View { _Stub() }
    public func onSubmit(_ action: @escaping () -> Void) -> some View { _Stub() }
    public func environmentObject<T: ObservableObject>(_ object: T) -> some View { _Stub() }
    public func environment<V>(_ keyPath: WritableKeyPath<EnvironmentValues, V>, _ value: V)
        -> some View
    { _Stub() }
    public func swipeActions<T: View>(
        edge: HorizontalAlignment = .trailing,
        allowsFullSwipe: Bool = true,
        @ViewBuilder content: () -> T
    ) -> some View { _Stub() }
    public func contentShape<S>(_ shape: S) -> some View { _Stub() }
    public func ignoresSafeArea(_ regions: SafeAreaRegions = .all, edges: Edge.Set = .all)
        -> some View
    { _Stub() }
    public func fileImporter(
        isPresented: Binding<Bool>,
        allowedContentTypes: [UTType],
        onCompletion: @escaping (Result<URL, Error>) -> Void
    ) -> some View { _Stub() }
}

public struct SafeAreaRegions: OptionSet, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }
    public static let all = SafeAreaRegions(rawValue: 1)
    public static let container = SafeAreaRegions(rawValue: 2)
    public static let keyboard = SafeAreaRegions(rawValue: 4)
}

public struct UTType: Sendable {
    public static let javaScript = UTType()
    public static let plainText = UTType()
    public static let item = UTType()
}

public struct Font: Sendable {
    public static let body = Font()
    public static let caption = Font()
    public static let footnote = Font()
    public static let headline = Font()
    public static let subheadline = Font()
    public static let title = Font()
    public static let largeTitle = Font()
    public enum Design: Sendable { case `default`, monospaced, rounded, serif }
    public enum TextStyle: Sendable { case body, caption, footnote, headline, title }
    public static func system(_ style: TextStyle, design: Design = .default) -> Font { Font() }
    public static func system(size: CGFloat, design: Design = .default) -> Font { Font() }
}

public enum NavigationBarItem {
    public enum TitleDisplayMode: Sendable { case automatic, inline, large }
}

public struct TextInputAutocapitalization: Sendable {
    public static let never = TextInputAutocapitalization()
    public static let sentences = TextInputAutocapitalization()
    public static let words = TextInputAutocapitalization()
    public static let characters = TextInputAutocapitalization()
}

public enum UIKeyboardType: Sendable {
    case `default`
    case URL
    case numberPad
    case emailAddress
}

// Style values, expressed the way the real ones are: a protocol plus a
// constrained extension, which is what makes `.roundedBorder` resolve.
public protocol TextFieldStyle {}
public struct RoundedBorderTextFieldStyle: TextFieldStyle { public init() {} }
public struct PlainTextFieldStyle: TextFieldStyle { public init() {} }
extension TextFieldStyle where Self == RoundedBorderTextFieldStyle {
    public static var roundedBorder: RoundedBorderTextFieldStyle { .init() }
}
extension TextFieldStyle where Self == PlainTextFieldStyle {
    public static var plain: PlainTextFieldStyle { .init() }
}

public protocol ButtonStyle {}
public struct BorderedButtonStyle: ButtonStyle { public init() {} }
public struct PlainButtonStyle: ButtonStyle { public init() {} }
extension ButtonStyle where Self == BorderedButtonStyle {
    public static var bordered: BorderedButtonStyle { .init() }
    public static var borderedProminent: BorderedButtonStyle { .init() }
}
extension ButtonStyle where Self == PlainButtonStyle {
    public static var plain: PlainButtonStyle { .init() }
}

public protocol PickerStyle {}
public struct SegmentedPickerStyle: PickerStyle { public init() {} }
public struct MenuPickerStyle: PickerStyle { public init() {} }
extension PickerStyle where Self == SegmentedPickerStyle {
    public static var segmented: SegmentedPickerStyle { .init() }
}
extension PickerStyle where Self == MenuPickerStyle {
    public static var menu: MenuPickerStyle { .init() }
}

public protocol ListStyle {}
public struct InsetGroupedListStyle: ListStyle { public init() {} }
public struct PlainListStyle: ListStyle { public init() {} }
extension ListStyle where Self == InsetGroupedListStyle {
    public static var insetGrouped: InsetGroupedListStyle { .init() }
}
extension ListStyle where Self == PlainListStyle {
    public static var plain: PlainListStyle { .init() }
}

public struct TextSelectability: Sendable {
    public init() {}
    public static var enabled: TextSelectability { .init() }
    public static var disabled: TextSelectability { .init() }
}

// MARK: - Toolbar

public struct ToolbarItem<ID, Content: View>: View {
    public typealias Body = Never
    public init(
        placement: ToolbarItemPlacement = .automatic,
        @ViewBuilder content: () -> Content
    ) where ID == Void { _ = content() }
}

public struct ToolbarItemGroup<Content: View>: View {
    public typealias Body = Never
    public init(
        placement: ToolbarItemPlacement = .automatic,
        @ViewBuilder content: () -> Content
    ) { _ = content() }
}

public struct ToolbarItemPlacement: Sendable {
    public static let automatic = ToolbarItemPlacement()
    public static let primaryAction = ToolbarItemPlacement()
    public static let confirmationAction = ToolbarItemPlacement()
    public static let cancellationAction = ToolbarItemPlacement()
    public static let bottomBar = ToolbarItemPlacement()
    public static let topBarLeading = ToolbarItemPlacement()
    public static let topBarTrailing = ToolbarItemPlacement()
}

// MARK: - Shapes

public struct RoundedRectangle: View, Sendable {
    public typealias Body = Never
    public init(cornerRadius: CGFloat) {}
}

public struct Rectangle: View, Sendable {
    public typealias Body = Never
    public init() {}
}


// MARK: - UIKit bridging

/// Refines `View`, as the real one does — otherwise a representable cannot take
/// `.id()` or any other modifier, which is how the webview rebuild is driven.
@MainActor
public protocol UIViewRepresentable: View where Body == Never {
    associatedtype UIViewType: UIView
    associatedtype Coordinator = Void
    func makeUIView(context: UIViewRepresentableContext<Self>) -> UIViewType
    func updateUIView(_ uiView: UIViewType, context: UIViewRepresentableContext<Self>)
    func makeCoordinator() -> Coordinator
}

extension UIViewRepresentable where Coordinator == Void {
    public func makeCoordinator() -> Void { () }
}

public struct UIViewRepresentableContext<Representable: UIViewRepresentable> {
    public let coordinator: Representable.Coordinator
}
