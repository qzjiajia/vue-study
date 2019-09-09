import { VNode, VNodeChild } from './vnode'
import { ReactiveEffect, reactive, readonly } from '@vue/reactivity'
import {
  PublicInstanceProxyHandlers,
  ComponentPublicInstance
} from './componentPublicInstanceProxy'
import { ComponentPropsOptions } from './componentProps'
import { Slots } from './componentSlots'
import { warn } from './warning'
import {
  ErrorCodes,
  callWithErrorHandling,
  callWithAsyncErrorHandling
} from './errorHandling'
import { AppContext, createAppContext } from './apiApp'
import { Directive } from './directives'
import { applyOptions, ComponentOptions } from './componentOptions'
import {
  EMPTY_OBJ,
  isFunction,
  capitalize,
  NOOP,
  isArray,
  isObject
} from '@vue/shared'

export type Data = { [key: string]: unknown }

export interface FunctionalComponent<P = {}> {
  (props: P, ctx: SetupContext): VNodeChild
  props?: ComponentPropsOptions<P>
  displayName?: string
}

export type Component = ComponentOptions | FunctionalComponent

type LifecycleHook = Function[] | null

export const enum LifecycleHooks {
  BEFORE_CREATE = 'bc',
  CREATED = 'c',
  BEFORE_MOUNT = 'bm',
  MOUNTED = 'm',
  BEFORE_UPDATE = 'bu',
  UPDATED = 'u',
  BEFORE_UNMOUNT = 'bum',
  UNMOUNTED = 'um',
  DEACTIVATED = 'da',
  ACTIVATED = 'a',
  RENDER_TRIGGERED = 'rtg',
  RENDER_TRACKED = 'rtc',
  ERROR_CAPTURED = 'ec'
}

type Emit = ((event: string, ...args: unknown[]) => void)

export interface SetupContext {
  attrs: Data
  slots: Slots
  emit: Emit
}

type RenderFunction = () => VNodeChild

export interface ComponentInternalInstance {
  type: FunctionalComponent | ComponentOptions
  parent: ComponentInternalInstance | null
  appContext: AppContext
  root: ComponentInternalInstance
  vnode: VNode
  next: VNode | null
  subTree: VNode
  update: ReactiveEffect
  render: RenderFunction | null
  effects: ReactiveEffect[] | null
  provides: Data

  components: Record<string, Component>
  directives: Record<string, Directive>

  asyncDep: Promise<any> | null
  asyncResult: any
  asyncResolved: boolean

  // the rest are only for stateful components
  renderContext: Data
  data: Data
  props: Data
  attrs: Data
  slots: Slots
  renderProxy: ComponentPublicInstance | null
  propsProxy: Data | null
  setupContext: SetupContext | null
  refs: Data
  emit: Emit

  // user namespace
  user: { [key: string]: any }

  // lifecycle
  [LifecycleHooks.BEFORE_CREATE]: LifecycleHook
  [LifecycleHooks.CREATED]: LifecycleHook
  [LifecycleHooks.BEFORE_MOUNT]: LifecycleHook
  [LifecycleHooks.MOUNTED]: LifecycleHook
  [LifecycleHooks.BEFORE_UPDATE]: LifecycleHook
  [LifecycleHooks.UPDATED]: LifecycleHook
  [LifecycleHooks.BEFORE_UNMOUNT]: LifecycleHook
  [LifecycleHooks.UNMOUNTED]: LifecycleHook
  [LifecycleHooks.RENDER_TRACKED]: LifecycleHook
  [LifecycleHooks.RENDER_TRIGGERED]: LifecycleHook
  [LifecycleHooks.ACTIVATED]: LifecycleHook
  [LifecycleHooks.DEACTIVATED]: LifecycleHook
  [LifecycleHooks.ERROR_CAPTURED]: LifecycleHook
}

const emptyAppContext = createAppContext()

export function createComponentInstance(
  vnode: VNode,
  parent: ComponentInternalInstance | null
): ComponentInternalInstance {
  // inherit parent app context - or - if root, adopt from root vnode
  const appContext =
    (parent ? parent.appContext : vnode.appContext) || emptyAppContext
  const instance = {
    vnode,
    parent,
    appContext,
    type: vnode.type as Component,
    root: null as any, // set later so it can point to itself
    next: null,
    subTree: null as any,
    update: null as any,
    render: null,
    renderProxy: null,
    propsProxy: null,
    setupContext: null,
    effects: null,
    provides: parent ? parent.provides : Object.create(appContext.provides),

    // setup context properties
    renderContext: EMPTY_OBJ,
    data: EMPTY_OBJ,
    props: EMPTY_OBJ,
    attrs: EMPTY_OBJ,
    slots: EMPTY_OBJ,
    refs: EMPTY_OBJ,

    // per-instance asset storage (mutable during options resolution)
    components: Object.create(appContext.components),
    directives: Object.create(appContext.directives),

    // async dependency management
    asyncDep: null,
    asyncResult: null,
    asyncResolved: false,

    // user namespace for storing whatever the user assigns to `this`
    user: {},

    // lifecycle hooks
    // not using enums here because it results in computed properties
    bc: null,
    c: null,
    bm: null,
    m: null,
    bu: null,
    u: null,
    um: null,
    bum: null,
    da: null,
    a: null,
    rtg: null,
    rtc: null,
    ec: null,

    emit: (event: string, ...args: unknown[]) => {
      const props = instance.vnode.props || EMPTY_OBJ
      const handler = props[`on${event}`] || props[`on${capitalize(event)}`]
      if (handler) {
        if (isArray(handler)) {
          for (let i = 0; i < handler.length; i++) {
            callWithAsyncErrorHandling(
              handler[i],
              instance,
              ErrorCodes.COMPONENT_EVENT_HANDLER,
              args
            )
          }
        } else {
          callWithAsyncErrorHandling(
            handler,
            instance,
            ErrorCodes.COMPONENT_EVENT_HANDLER,
            args
          )
        }
      }
    }
  }

  instance.root = parent ? parent.root : instance
  return instance
}

export let currentInstance: ComponentInternalInstance | null = null

export const getCurrentInstance: () => ComponentInternalInstance | null = () =>
  currentInstance

export const setCurrentInstance = (
  instance: ComponentInternalInstance | null
) => {
  currentInstance = instance
}

export function setupStatefulComponent(instance: ComponentInternalInstance) {
  const Component = instance.type as ComponentOptions
  // 1. create render proxy
  instance.renderProxy = new Proxy(instance, PublicInstanceProxyHandlers) as any
  // 2. create props proxy
  // the propsProxy is a reactive AND readonly proxy to the actual props.
  // it will be updated in resolveProps() on updates before render
  const propsProxy = (instance.propsProxy = readonly(instance.props))
  // 3. call setup()
  const { setup } = Component
  if (setup) {
    const setupContext = (instance.setupContext =
      setup.length > 1 ? createSetupContext(instance) : null)

    currentInstance = instance
    const setupResult = callWithErrorHandling(
      setup,
      instance,
      ErrorCodes.SETUP_FUNCTION,
      [propsProxy, setupContext]
    )
    currentInstance = null

    if (
      setupResult &&
      isFunction(setupResult.then) &&
      isFunction(setupResult.catch)
    ) {
      if (__FEATURE_SUSPENSE__) {
        // async setup returned Promise.
        // bail here and wait for re-entry.
        instance.asyncDep = setupResult as Promise<any>
      } else if (__DEV__) {
        warn(
          `setup() returned a Promise, but the version of Vue you are using ` +
            `does not support it yet.`
        )
      }
      return
    } else {
      handleSetupResult(instance, setupResult)
    }
  } else {
    finishComponentSetup(instance)
  }
}

export function handleSetupResult(
  instance: ComponentInternalInstance,
  setupResult: unknown
) {
  if (isFunction(setupResult)) {
    // setup returned an inline render function
    instance.render = setupResult as RenderFunction
  } else if (isObject(setupResult)) {
    // setup returned bindings.
    // assuming a render function compiled from template is present.
    instance.renderContext = reactive(setupResult)
  } else if (__DEV__ && setupResult !== undefined) {
    warn(
      `setup() should return an object. Received: ${
        setupResult === null ? 'null' : typeof setupResult
      }`
    )
  }
  finishComponentSetup(instance)
}

function finishComponentSetup(instance: ComponentInternalInstance) {
  const Component = instance.type as ComponentOptions
  if (!instance.render) {
    if (__DEV__ && !Component.render) {
      warn(
        `Component is missing render function. Either provide a template or ` +
          `return a render function from setup().`
      )
    }
    instance.render = (Component.render || NOOP) as RenderFunction
  }

  // support for 2.x options
  if (__FEATURE_OPTIONS__) {
    currentInstance = instance
    applyOptions(instance, Component)
    currentInstance = null
  }

  if (instance.renderContext === EMPTY_OBJ) {
    instance.renderContext = reactive({})
  }
}

// used to identify a setup context proxy
export const SetupProxySymbol = Symbol()

const SetupProxyHandlers: { [key: string]: ProxyHandler<any> } = {}
;['attrs', 'slots', 'refs'].forEach((type: string) => {
  SetupProxyHandlers[type] = {
    get: (instance, key) => (instance[type] as any)[key],
    has: (instance, key) =>
      key === SetupProxySymbol || key in (instance[type] as any),
    ownKeys: instance => Reflect.ownKeys(instance[type] as any),
    // this is necessary for ownKeys to work properly
    getOwnPropertyDescriptor: (instance, key) =>
      Reflect.getOwnPropertyDescriptor(instance[type], key),
    set: () => false,
    deleteProperty: () => false
  }
})

function createSetupContext(instance: ComponentInternalInstance): SetupContext {
  const context = {
    // attrs, slots & refs are non-reactive, but they need to always expose
    // the latest values (instance.xxx may get replaced during updates) so we
    // need to expose them through a proxy
    attrs: new Proxy(instance, SetupProxyHandlers.attrs),
    slots: new Proxy(instance, SetupProxyHandlers.slots),
    refs: new Proxy(instance, SetupProxyHandlers.refs),
    emit: instance.emit
  } as any
  return __DEV__ ? Object.freeze(context) : context
}