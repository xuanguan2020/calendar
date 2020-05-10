import { Ref, createRef, ComponentChildren, h, RefObject, createContext } from '../vdom'
import { setRef, BaseComponent } from '../vdom-util'
import { isPropsEqual } from '../util/object'


export interface RenderHookProps<HookProps> {
  hookProps: HookProps
  classNames: ClassNameGenerator<HookProps>
  content: CustomContentGenerator<HookProps>
  defaultContent?: DefaultContentGenerator<HookProps>
  didMount: DidMountHandler<HookProps>
  willUnmount: WillUnmountHandler<HookProps>
  children: RenderHookPropsChildren
  elRef?: Ref<any>
}

export type RenderHookPropsChildren = (
  rootElRef: Ref<any>,
  classNames: string[],
  innerElRef: Ref<any>,
  innerContent: ComponentChildren // if falsy, means it wasn't specified
) => ComponentChildren

export interface ContentTypeHandlers {
  [contentKey: string]: () => (el: HTMLElement, contentVal: any) => void
}


// NOTE: in JSX, you should always use this class with <HookProps> arg. otherwise, will default to any???
export class RenderHook<HookProps> extends BaseComponent<RenderHookProps<HookProps>> {

  private rootElRef = createRef()


  render() {
    let { props } = this
    let { hookProps } = props

    return (
      <MountHook hookProps={hookProps} didMount={props.didMount} willUnmount={props.willUnmount} elRef={this.handleRootEl}>
        {(rootElRef) => (
          <ContentHook hookProps={hookProps} content={props.content} defaultContent={props.defaultContent} backupElRef={this.rootElRef}>
            {(innerElRef, innerContent) => props.children(
              rootElRef,
              normalizeClassNames(props.classNames, hookProps),
              innerElRef,
              innerContent
            )}
          </ContentHook>
        )}
      </MountHook>
    )
  }


  handleRootEl = (el: HTMLElement | null) => {
    setRef(this.rootElRef, el)

    if (this.props.elRef) {
      setRef(this.props.elRef, el)
    }
  }

}



export interface ObjCustomContent {
  html: string
  domNodes: any[]
  [custom: string]: any // TODO: expose hook for plugins to add!
}

export type CustomContent = ComponentChildren | ObjCustomContent
export type CustomContentGenerator<HookProps> = CustomContent | ((hookProps: HookProps) => CustomContent)
export type DefaultContentGenerator<HookProps> = (hookProps: HookProps) => ComponentChildren

// for forcing rerender of components that use the ContentHook
export const CustomContentRenderContext = createContext<number>(0)

export interface ContentHookProps<HookProps> {
  hookProps: HookProps
  content: CustomContentGenerator<HookProps>
  defaultContent?: DefaultContentGenerator<HookProps>
  children: (
    innerElRef: Ref<any>,
    innerContent: ComponentChildren // if falsy, means it wasn't specified
  ) => ComponentChildren
  backupElRef?: RefObject<any>
}

export class ContentHook<HookProps> extends BaseComponent<ContentHookProps<HookProps>> { // TODO: rename to CustomContentHook?

  private innerElRef = createRef()
  private customContentInfo: {
    contentKey: string
    contentVal: any
    handler: (el: HTMLElement, contentVal: any) => void
  }


  render() {
    return (
      <CustomContentRenderContext.Consumer>
        {() => (
          this.props.children(this.innerElRef, this.renderInnerContent())
        )}
      </CustomContentRenderContext.Consumer>
    )
  }


  componentDidMount() {
    this.updateCustomContent()
  }


  componentDidUpdate() {
    this.updateCustomContent()
  }


  private renderInnerContent() {
    let { contentTypeHandlers } = this.context.pluginHooks
    let { props, customContentInfo } = this
    let rawVal = props.content
    let innerContent = normalizeContent(rawVal, props.hookProps)
    let innerContentVDom: ComponentChildren = null

    if (innerContent === undefined) { // use the default
      innerContent = normalizeContent(props.defaultContent, props.hookProps)
    }

    if (innerContent !== undefined) { // we allow custom content handlers to return nothing

      if (customContentInfo) {
        customContentInfo.contentVal = innerContent[customContentInfo.contentKey]

      } else {
        // look for a prop that would indicate a custom content handler is needed
        for (let contentKey in contentTypeHandlers) {

          if (innerContent[contentKey] !== undefined) {
            customContentInfo = this.customContentInfo = {
              contentKey,
              contentVal: innerContent[contentKey],
              handler: contentTypeHandlers[contentKey]()
            }
            break
          }
        }
      }

      if (customContentInfo) {
        innerContentVDom = [] // signal that something was specified
      } else {
        innerContentVDom = innerContent // assume a [p]react vdom node. use it
      }
    }

    return innerContentVDom
  }


  private updateCustomContent() {
    if (this.customContentInfo) {
      this.customContentInfo.handler(
        this.innerElRef.current || this.props.backupElRef.current, // the element to render into
        this.customContentInfo.contentVal
      )
    }
  }

}




export type HookPropsWithEl<HookProps> = HookProps & { el: HTMLElement }
export type DidMountHandler<HookProps> = (hookProps: HookPropsWithEl<HookProps>) => void
export type WillUnmountHandler<HookProps> = (hookProps: HookPropsWithEl<HookProps>) => void

export interface MountHookProps<HookProps> {
  hookProps: HookProps
  didMount: DidMountHandler<HookProps>
  willUnmount: WillUnmountHandler<HookProps>
  children: (rootElRef: Ref<any>) => ComponentChildren
  elRef?: Ref<any> // maybe get rid of once we have better API for caller to combine refs
}

export class MountHook<HookProps> extends BaseComponent<MountHookProps<HookProps>> {

  rootEl: HTMLElement


  render() {
    return this.props.children(this.handleRootEl)
  }


  componentDidMount() {
    let callback = this.props.didMount
    callback && callback({ ...this.props.hookProps, el: this.rootEl })
  }


  componentWillUnmount() {
    let callback = this.props.willUnmount
    callback && callback({ ...this.props.hookProps, el: this.rootEl })
  }


  private handleRootEl = (rootEl: HTMLElement) => {
    this.rootEl = rootEl

    if (this.props.elRef) {
      setRef(this.props.elRef, rootEl)
    }
  }

}


export function buildClassNameNormalizer<HookProps>() { // TODO: general deep-memoizer?
  let currentGenerator: ClassNameGenerator<HookProps>
  let currentHookProps: HookProps
  let currentClassNames: string[] = []

  return function(generator: ClassNameGenerator<HookProps>, hookProps: HookProps) {
    if (!currentHookProps || !isPropsEqual(currentHookProps, hookProps) || generator !== currentGenerator) {
      currentGenerator = generator
      currentHookProps = hookProps
      currentClassNames = normalizeClassNames(generator, hookProps)
    }

    return currentClassNames
  }
}


export type RawClassNames = string | string[] // also somewhere else? a util for parsing classname string/array?
export type ClassNameGenerator<HookProps> = RawClassNames | ((hookProps: HookProps) => RawClassNames)


function normalizeClassNames<HookProps>(classNames: ClassNameGenerator<HookProps>, hookProps: HookProps): string[] {

  if (typeof classNames === 'function') {
    classNames = classNames(hookProps)
  }

  if (Array.isArray(classNames)) {
    return classNames

  } else if (typeof classNames === 'string') {
    return classNames.split(' ')

  } else {
    return []
  }
}


function normalizeContent(input, hookProps) {
  if (typeof input === 'function') {
    return input(hookProps, h) // give the function the vdom-creation func
  } else {
    return input
  }
}